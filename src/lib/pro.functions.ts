// ============================================================
// Fonctions serveur de l'espace pro (salon connecté en double authentification).
// Lectures et modifications simples : avec le jeton de la pro (règles RLS).
// Argent, statuts, santé, suppression : clé de service APRÈS exigerMembre().
// ============================================================
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  clienteSchema,
  horairesSchema,
  idSchema,
  indispoSchema,
  notesSchema,
  periodeSchema,
  prestationSchema,
  reglagesSchema,
  salonIdSchema,
  santeSchema,
  statutSchema,
} from "./schemas";
import { messageErreur, salonRembourse } from "./regles";
import { parisToUtc } from "./tz";

function verifier<T>(res: { data: T; error: { message: string } | null }, msg: string): T {
  if (res.error) {
    console.error(`[pro] ${msg} :`, res.error.message);
    throw new Error(msg);
  }
  return res.data;
}

// ------------------------------------------------------------
// Session et salon
// ------------------------------------------------------------
export const monEspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
  const membres = verifier(
    await context.supabase.from("membres").select("salon_id, role").eq("user_id", context.userId),
    "Lecture de votre compte impossible.",
  ) as { salon_id: string; role: string }[];
  if (!membres.length) return { salon: null, role: null, aal: String(context.claims?.aal ?? "") };
  const salon = verifier(
    await context.supabase.from("salons").select("*").eq("id", membres[0].salon_id).maybeSingle(),
    "Lecture du salon impossible.",
  );
  return {
    salon: salon as { [cle: string]: string | number | boolean | null } | null,
    role: membres[0].role,
    aal: String(context.claims?.aal ?? ""),
  };
});

// ------------------------------------------------------------
// Rendez-vous
// ------------------------------------------------------------
const SELECT_AGENDA =
  "id, statut, source, prestation_nom, date_debut, date_fin, prix_total, acompte_montant, acompte_statut, montant_rembourse, commentaire_cliente, note_interne, cliente_id, clientes(prenom, nom, telephone, email)";

export const chargerAgenda = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => periodeSchema.parse(d))
  .handler(async ({ data, context }) => {
    const debut = parisToUtc(data.debut, "00:00").toISOString();
    const fin = parisToUtc(data.fin, "23:59").toISOString();
    return verifier(
      await context.supabase
        .from("reservations")
        .select(SELECT_AGENDA)
        .eq("salon_id", data.salonId)
        .gte("date_debut", debut)
        .lte("date_debut", fin)
        .neq("statut", "en_attente_paiement")
        .order("date_debut"),
      "Lecture de l'agenda impossible.",
    );
  });

export const chargerTableauDeBord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => salonIdSchema.parse(d))
  .handler(async ({ data, context }) => {
    const maintenant = new Date();
    const debutMois = new Date(maintenant.getFullYear(), maintenant.getMonth(), 1).toISOString();
    const [aValider, mois] = await Promise.all([
      context.supabase
        .from("reservations")
        .select(SELECT_AGENDA)
        .eq("salon_id", data.salonId)
        .eq("statut", "a_valider")
        .order("date_debut"),
      context.supabase
        .from("reservations")
        .select("statut, prix_total, acompte_montant, acompte_statut, montant_rembourse")
        .eq("salon_id", data.salonId)
        .gte("date_debut", debutMois)
        .lte("date_debut", maintenant.toISOString()),
    ]);
    const lignes = verifier(mois, "Statistiques indisponibles.") as {
      statut: string;
      prix_total: number;
      acompte_montant: number;
      acompte_statut: string;
      montant_rembourse: number;
    }[];
    const honorees = lignes.filter((l) => l.statut === "honoree");
    return {
      aValider: verifier(aValider, "Lecture des demandes impossible."),
      stats: {
        chiffreAffaires: honorees.reduce((s, l) => s + Number(l.prix_total), 0),
        rendezVous: honorees.length,
        absentes: lignes.filter((l) => l.statut === "absente").length,
        // Acomptes gardés lors d'une absence ou d'une annulation tardive : l'argent qu'un « lapin » aurait coûté
        acomptesConserves: lignes
          .filter((l) => l.acompte_statut === "conserve")
          .reduce((s, l) => s + Number(l.acompte_montant) - Number(l.montant_rembourse), 0),
      },
    };
  });

export const changerStatut = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => statutSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { exigerMembre } = await import("./pro.server");
    await exigerMembre(context, data.salonId);
    const { supabaseService } = await import("./supabase.server");
    const { chargerRdv, rembourser, emailsDecision } = await import("./paiement.server");

    const avant = await chargerRdv({ id: data.reservationId });
    if (!avant || avant.salon_id !== data.salonId) throw new Error("Rendez-vous introuvable.");

    const { data: rows, error } = await supabaseService().rpc("changer_statut", {
      p_reservation: data.reservationId,
      p_statut: data.statut,
      p_user: context.userId,
    });
    if (error) throw new Error(messageErreur(error.message));
    const res = (rows as { remboursable: number }[])[0];

    let rendu = 0;
    let echecRemboursement = false;
    if (salonRembourse(data.statut) && Number(res.remboursable) > 0) {
      const r = await rembourser(avant, Number(res.remboursable), `salon-${data.statut}`);
      if (r === null) echecRemboursement = true;
      else rendu = r;
    }
    await emailsDecision(avant, data.statut, rendu).catch((e) => console.error("[pro] e-mail", e));
    return { rembourse: rendu, echecRemboursement };
  });

export const enregistrerNoteRdv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ({ ...idSchema.parse(d), note: String((d as { note?: string }).note ?? "").slice(0, 1000) }))
  .handler(async ({ data, context }) => {
    verifier(
      await context.supabase
        .from("reservations")
        .update({ note_interne: data.note })
        .eq("id", data.id)
        .eq("salon_id", data.salonId),
      "Note non enregistrée.",
    );
    return { ok: true };
  });

// ------------------------------------------------------------
// Prestations
// ------------------------------------------------------------
export const chargerPrestations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => salonIdSchema.parse(d))
  .handler(async ({ data, context }) =>
    verifier(
      await context.supabase.from("prestations").select("*").eq("salon_id", data.salonId).order("ordre"),
      "Lecture des prestations impossible.",
    ),
  );

export const enregistrerPrestation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => prestationSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { id, salonId, ...champs } = data;
    const ligne = { ...champs, salon_id: salonId };
    const res = id
      ? await context.supabase.from("prestations").update(ligne).eq("id", id).eq("salon_id", salonId)
      : await context.supabase.from("prestations").insert(ligne);
    verifier(res, "Prestation non enregistrée.");
    return { ok: true };
  });

// ------------------------------------------------------------
// Horaires et congés
// ------------------------------------------------------------
export const chargerHoraires = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => salonIdSchema.parse(d))
  .handler(async ({ data, context }) => {
    const [h, i] = await Promise.all([
      context.supabase.from("horaires").select("*").eq("salon_id", data.salonId).order("jour_semaine"),
      context.supabase
        .from("indisponibilites")
        .select("*")
        .eq("salon_id", data.salonId)
        .gte("date_fin", new Date().toISOString())
        .order("date_debut"),
    ]);
    return { horaires: verifier(h, "Lecture des horaires impossible."), indisponibilites: verifier(i, "Lecture des congés impossible.") };
  });

export const enregistrerHoraires = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => horairesSchema.parse(d))
  .handler(async ({ data, context }) => {
    const lignes = data.jours.map((j) => ({ ...j, salon_id: data.salonId }));
    verifier(
      await context.supabase.from("horaires").upsert(lignes, { onConflict: "salon_id,jour_semaine" }),
      "Horaires non enregistrés.",
    );
    return { ok: true };
  });

export const ajouterIndispo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => indispoSchema.parse(d))
  .handler(async ({ data, context }) => {
    verifier(
      await context.supabase.from("indisponibilites").insert({
        salon_id: data.salonId,
        date_debut: parisToUtc(data.debut, "00:00").toISOString(),
        date_fin: parisToUtc(data.fin, "23:59").toISOString(),
        motif: data.motif,
      }),
      "Congé non enregistré.",
    );
    return { ok: true };
  });

export const supprimerIndispo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => idSchema.parse(d))
  .handler(async ({ data, context }) => {
    verifier(
      await context.supabase.from("indisponibilites").delete().eq("id", data.id).eq("salon_id", data.salonId),
      "Suppression impossible.",
    );
    return { ok: true };
  });

// ------------------------------------------------------------
// Réglages du salon
// ------------------------------------------------------------
export const enregistrerReglages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => reglagesSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { salonId, ...champs } = data;
    const { exigerMembre } = await import("./pro.server");
    await exigerMembre(context, salonId, "proprietaire");
    verifier(await context.supabase.from("salons").update(champs).eq("id", salonId), "Réglages non enregistrés.");
    return { ok: true };
  });

/** Ouvre (ou reprend) l'inscription du salon chez Stripe. Renvoie l'adresse de la page Stripe. */
export const connecterStripe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => salonIdSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { exigerMembre } = await import("./pro.server");
    await exigerMembre(context, data.salonId, "proprietaire");
    const { supabaseService } = await import("./supabase.server");
    const { getStripe, messageStripe } = await import("./stripe.server");
    const { adresseSite } = await import("./secrets.server");
    const admin = supabaseService();
    const { data: s } = await admin.from("salons").select("email_contact, stripe_account_id").eq("id", data.salonId).single();
    const salon = s as { email_contact: string; stripe_account_id: string | null };
    try {
      let compte = salon.stripe_account_id;
      if (!compte) {
        const cree = await getStripe().accounts.create(
          { type: "standard", country: "FR", email: salon.email_contact, metadata: { salonId: data.salonId } },
          { idempotencyKey: `compte-${data.salonId}` },
        );
        compte = cree.id;
        await admin.from("salons").update({ stripe_account_id: compte }).eq("id", data.salonId);
      }
      const lien = await getStripe().accountLinks.create({
        account: compte,
        type: "account_onboarding",
        refresh_url: `${adresseSite()}/pro/reglages?stripe=reprendre`,
        return_url: `${adresseSite()}/pro/reglages?stripe=retour`,
      });
      return { url: lien.url };
    } catch (e) {
      console.error("[stripe] ouverture de compte :", messageStripe(e));
      throw new Error("Stripe n'a pas pu ouvrir l'inscription. Réessayez dans un instant.");
    }
  });

/** Relit l'état du compte Stripe du salon (paiements activés ou non). */
export const actualiserStripe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => salonIdSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { exigerMembre } = await import("./pro.server");
    await exigerMembre(context, data.salonId);
    const { supabaseService } = await import("./supabase.server");
    const { getStripe } = await import("./stripe.server");
    const admin = supabaseService();
    const { data: s } = await admin.from("salons").select("stripe_account_id").eq("id", data.salonId).single();
    const compte = (s as { stripe_account_id: string | null }).stripe_account_id;
    if (!compte) return { actifs: false, compte: false };
    const acct = await getStripe().accounts.retrieve(compte);
    const actifs = !!acct.charges_enabled;
    await admin.from("salons").update({ paiements_actifs: actifs }).eq("id", data.salonId);
    return { actifs, compte: true };
  });

// ------------------------------------------------------------
// Clientes
// ------------------------------------------------------------
export const chargerClientes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => salonIdSchema.parse(d))
  .handler(async ({ data, context }) =>
    verifier(
      await context.supabase
        .from("clientes")
        .select("id, prenom, nom, email, telephone, notes_privees, sante_consentement_le, derniere_activite_le")
        .eq("salon_id", data.salonId)
        .order("derniere_activite_le", { ascending: false })
        .limit(500),
      "Lecture des clientes impossible.",
    ),
  );

export const chargerHistoriqueCliente = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => clienteSchema.parse(d))
  .handler(async ({ data, context }) =>
    verifier(
      await context.supabase
        .from("reservations")
        .select("id, statut, prestation_nom, date_debut, prix_total")
        .eq("salon_id", data.salonId)
        .eq("cliente_id", data.clienteId)
        .neq("statut", "en_attente_paiement")
        .order("date_debut", { ascending: false })
        .limit(50),
      "Historique indisponible.",
    ),
  );

export const enregistrerNotes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => notesSchema.parse(d))
  .handler(async ({ data, context }) => {
    verifier(
      await context.supabase
        .from("clientes")
        .update({ notes_privees: data.notes_privees })
        .eq("id", data.clienteId)
        .eq("salon_id", data.salonId),
      "Notes non enregistrées.",
    );
    return { ok: true };
  });

/** Données de santé : chiffrées par le serveur, avec consentement explicite. */
export const enregistrerSante = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => santeSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { exigerMembre } = await import("./pro.server");
    await exigerMembre(context, data.salonId);
    const { supabaseService } = await import("./supabase.server");
    const { secretObligatoire } = await import("./secrets.server");
    const { chiffrerSante } = await import("./sante");
    const vide = !data.texte;
    const valeur = vide ? null : await chiffrerSante(data.texte, data.clienteId, secretObligatoire("SANTE_CLE"));
    const { error } = await supabaseService()
      .from("clientes")
      .update({ sante_chiffree: valeur, sante_consentement_le: vide ? null : new Date().toISOString() })
      .eq("id", data.clienteId)
      .eq("salon_id", data.salonId);
    if (error) throw new Error("Information non enregistrée.");
    return { ok: true };
  });

export const lireSante = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => clienteSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { exigerMembre } = await import("./pro.server");
    await exigerMembre(context, data.salonId);
    const { data: c } = await context.supabase
      .from("clientes")
      .select("sante_chiffree")
      .eq("id", data.clienteId)
      .eq("salon_id", data.salonId)
      .maybeSingle();
    const valeur = (c as { sante_chiffree: string | null } | null)?.sante_chiffree;
    if (!valeur) return { texte: "" };
    const { secretObligatoire } = await import("./secrets.server");
    const { dechiffrerSante } = await import("./sante");
    return { texte: await dechiffrerSante(valeur, data.clienteId, secretObligatoire("SANTE_CLE")) };
  });

/** Droit à l'effacement : supprime la fiche et tout son historique (propriétaire seulement). */
export const supprimerCliente = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => clienteSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { exigerMembre } = await import("./pro.server");
    await exigerMembre(context, data.salonId, "proprietaire");
    const { supabaseService } = await import("./supabase.server");
    const admin = supabaseService();
    const { count } = await admin
      .from("reservations")
      .select("id", { count: "exact", head: true })
      .eq("cliente_id", data.clienteId)
      .in("statut", ["a_valider", "confirmee"])
      .gte("date_debut", new Date().toISOString());
    if (count) throw new Error("Cette cliente a un rendez-vous à venir : annulez-le d'abord.");
    const { error } = await admin.from("clientes").delete().eq("id", data.clienteId).eq("salon_id", data.salonId);
    if (error) throw new Error("Suppression impossible.");
    return { ok: true };
  });

/** Export CSV du fichier clientes (droit à la portabilité, propriétaire seulement). */
export const exporterClientes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => salonIdSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { exigerMembre } = await import("./pro.server");
    await exigerMembre(context, data.salonId, "proprietaire");
    const lignes = verifier(
      await context.supabase
        .from("clientes")
        .select("prenom, nom, email, telephone, created_at, derniere_activite_le")
        .eq("salon_id", data.salonId)
        .order("nom"),
      "Export impossible.",
    ) as Record<string, string>[];
    // Protection contre l'injection de formules dans Excel (=, +, -, @)
    const cellule = (v: unknown) => {
      let s = String(v ?? "");
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const entete = ["Prénom", "Nom", "E-mail", "Téléphone", "Cliente depuis", "Dernière activité"];
    const corps = lignes.map((l) =>
      [l.prenom, l.nom, l.email, l.telephone, l.created_at?.slice(0, 10), l.derniere_activite_le?.slice(0, 10)]
        .map(cellule)
        .join(";"),
    );
    return { csv: "﻿" + [entete.map(cellule).join(";"), ...corps].join("\r\n") };
  });

export const chargerJournal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => salonIdSchema.parse(d))
  .handler(async ({ data, context }) =>
    verifier(
      await context.supabase
        .from("journal")
        .select("id, action, cible, details, cree_le, user_id")
        .eq("salon_id", data.salonId)
        .order("cree_le", { ascending: false })
        .limit(100),
      "Journal indisponible.",
    ),
  );
