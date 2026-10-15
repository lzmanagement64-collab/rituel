// ============================================================
// Fonctions serveur PUBLIQUES (page de réservation d'un salon).
// La visiteuse ne lit jamais la base directement : seules sortent
// les informations publiques du salon et des heures libres.
// ============================================================
import { createServerFn } from "@tanstack/react-start";
import { creneauxSchema, reservationSchema, slugSchema, tokenSchema } from "./schemas";
import { messageErreur } from "./regles";

export type SalonPublic = {
  id: string;
  slug: string;
  nom: string;
  metier: string;
  ville: string;
  telephone: string;
  instagram: string;
  description: string;
  couleur: string;
  acompte_pourcent: number;
  annulation_gratuite_heures: number;
  horizon_jours: number;
  paiements_actifs: boolean;
  ouvert: boolean;
};
export type PrestationPublique = {
  id: string;
  nom: string;
  description: string;
  duree_minutes: number;
  prix: number;
  acompte: number;
};
export type DonneesSalon = { salon: SalonPublic; prestations: PrestationPublique[]; reservable: boolean };

export const chargerSalon = createServerFn({ method: "GET" })
  .validator((d: unknown) => slugSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabasePublic } = await import("./supabase.server");
    const { clePubliqueStripe } = await import("./stripe.server");
    const client = supabasePublic();
    const [salon, prestations] = await Promise.all([
      client.rpc("salon_public", { p_slug: data.slug }),
      client.rpc("prestations_publiques", { p_slug: data.slug }),
    ]);
    if (salon.error || prestations.error) throw new Error("Chargement du salon impossible.");
    const s = (salon.data as Record<string, unknown>[] | null)?.[0];
    if (!s) return null;
    return {
      salon: s as {
        id: string;
        slug: string;
        nom: string;
        metier: string;
        ville: string;
        telephone: string;
        instagram: string;
        description: string;
        couleur: string;
        acompte_pourcent: number;
        annulation_gratuite_heures: number;
        horizon_jours: number;
        paiements_actifs: boolean;
        ouvert: boolean;
      },
      prestations: (prestations.data ?? []) as {
        id: string;
        nom: string;
        description: string;
        duree_minutes: number;
        prix: number;
        acompte: number;
      }[],
      reservable: !!clePubliqueStripe(),
    };
  });

export const chargerCreneaux = createServerFn({ method: "POST" })
  .validator((d: unknown) => creneauxSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabasePublic } = await import("./supabase.server");
    const { data: rows, error } = await supabasePublic().rpc("creneaux_disponibles", {
      p_slug: data.slug,
      p_date: data.date,
      p_prestation: data.prestationId,
    });
    if (error) throw new Error("Impossible de charger les créneaux.");
    return ((rows ?? []) as { heure: string }[]).map((r) => String(r.heure).slice(0, 5));
  });

/**
 * Crée la demande (créneau bloqué 35 min) puis le paiement de l'acompte
 * sur le compte Stripe du salon. Le montant vient de la base, jamais du navigateur.
 */
export const reserver = createServerFn({ method: "POST" })
  .validator((d: unknown) => reservationSchema.parse(d))
  .handler(async ({ data }) => {
    if (data.site) throw new Error("Demande refusée.");
    const { supabaseService } = await import("./supabase.server");
    const { getStripe, clePubliqueStripe, messageStripe } = await import("./stripe.server");
    const admin = supabaseService();
    const clePublique = clePubliqueStripe();
    if (!clePublique) throw new Error("Le paiement en ligne n'est pas encore disponible.");

    const { data: rows, error } = await admin.rpc("creer_demande", {
      p_slug: data.slug,
      p_prestation: data.prestationId,
      p_date: data.date,
      p_heure: data.heure,
      p_prenom: data.prenom,
      p_nom: data.nom,
      p_email: data.email,
      p_telephone: data.telephone,
      p_commentaire: data.commentaire,
    });
    if (error) throw new Error(messageErreur(error.message));
    const demande = (rows as { reservation_id: string; token: string; acompte: number; prix: number }[])[0];

    const { data: salon } = await admin
      .from("salons")
      .select("nom, stripe_account_id")
      .eq("slug", data.slug)
      .single();
    const compte = (salon as { nom: string; stripe_account_id: string | null } | null)?.stripe_account_id;

    try {
      if (!compte) throw new Error("Compte de paiement du salon manquant.");
      const intent = await getStripe().paymentIntents.create(
        {
          amount: Math.round(Number(demande.acompte) * 100),
          currency: "eur",
          automatic_payment_methods: { enabled: true },
          receipt_email: data.email,
          description: `Acompte — ${(salon as { nom: string }).nom}`,
          metadata: { reservationId: demande.reservation_id },
        },
        { stripeAccount: compte, idempotencyKey: `acompte-${demande.reservation_id}` },
      );
      const { error: errMaj } = await admin
        .from("reservations")
        .update({ stripe_payment_intent: intent.id })
        .eq("id", demande.reservation_id);
      if (errMaj || !intent.client_secret) throw new Error("Enregistrement du paiement impossible.");
      return {
        token: demande.token,
        acompte: Number(demande.acompte),
        clientSecret: intent.client_secret,
        clePublique,
        compteStripe: compte,
      };
    } catch (e) {
      // Paiement impossible : on libère tout de suite le créneau.
      await admin
        .from("reservations")
        .update({ statut: "annulee", acompte_statut: "expire" })
        .eq("id", demande.reservation_id);
      console.error("[reservation] paiement impossible :", messageStripe(e));
      throw new Error("Le paiement n'a pas pu être préparé. Merci de réessayer dans un instant.");
    }
  });

/** Page « mon rendez-vous » (lien personnel reçu par e-mail). */
export const etatRendezVous = createServerFn({ method: "POST" })
  .validator((d: unknown) => tokenSchema.parse(d))
  .handler(async ({ data }) => {
    const { chargerRdv, verifierPaiement } = await import("./paiement.server");
    let r = await chargerRdv({ token: data.token });
    if (!r) return null;
    if (r.statut === "en_attente_paiement") {
      await verifierPaiement(r).catch((e) => console.error("[rdv] vérification paiement", e));
      r = (await chargerRdv({ token: data.token })) ?? r;
    }
    const { supabaseService } = await import("./supabase.server");
    const { data: s } = await supabaseService()
      .from("salons")
      .select("slug, annulation_gratuite_heures")
      .eq("id", r.salon_id)
      .single();
    const reglesSalon = s as { slug: string; annulation_gratuite_heures: number } | null;
    // Uniquement ce que la cliente a besoin de voir (pas d'identifiant Stripe, pas de note interne)
    return {
      statut: r.statut,
      prestation: r.prestation_nom,
      date_debut: r.date_debut,
      prix_total: Number(r.prix_total),
      acompte: Number(r.acompte_montant),
      rembourse: Number(r.montant_rembourse),
      prenom: r.clientes?.prenom ?? "",
      salon: {
        nom: r.salons?.nom ?? "",
        couleur: r.salons?.couleur ?? "#7a4b5c",
        telephone: r.salons?.telephone ?? "",
        // Adresse communiquée seulement une fois le rendez-vous confirmé
        adresse: ["confirmee", "honoree"].includes(r.statut) ? (r.salons?.adresse ?? "") : "",
        slug: reglesSalon?.slug ?? "",
        annulation_gratuite_heures: reglesSalon?.annulation_gratuite_heures ?? 48,
      },
    };
  });

export const annulerRendezVous = createServerFn({ method: "POST" })
  .validator((d: unknown) => tokenSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseService } = await import("./supabase.server");
    const { chargerRdv, rembourser, pourEmail } = await import("./paiement.server");
    const { emailRefuseOuAnnule, emailAnnulationAuSalon } = await import("./emails.server");
    const { data: rows, error } = await supabaseService().rpc("annuler_par_cliente", { p_token: data.token });
    if (error) throw new Error(messageErreur(error.message));
    const res = (rows as { reservation_id: string; a_rembourser: number; tardive: boolean }[])[0];
    const r = await chargerRdv({ id: res.reservation_id });
    let rendu = 0;
    if (r && Number(res.a_rembourser) > 0) {
      rendu = (await rembourser(r, Number(res.a_rembourser), "annulation-cliente")) ?? 0;
    }
    if (r?.salons && r.clientes) {
      await Promise.all([
        emailRefuseOuAnnule(r.salons, pourEmail(r), r.clientes.email, rendu, false),
        emailAnnulationAuSalon(r.salons, pourEmail(r), `${r.clientes.prenom} ${r.clientes.nom}`),
      ]);
    }
    return { rembourse: rendu, tardive: res.tardive };
  });
