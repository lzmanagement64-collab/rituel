// ============================================================
// Paiements et remboursements des acomptes — logique serveur uniquement.
// Toutes les opérations Stripe se font SUR LE COMPTE DU SALON (stripeAccount).
// ============================================================
import { supabaseService } from "./supabase.server";
import { getStripe, messageStripe } from "./stripe.server";
import {
  emailConfirme,
  emailDemandeRecue,
  emailNouvelleDemande,
  emailRefuseOuAnnule,
} from "./emails.server";

export const SELECT_RDV =
  "id, salon_id, statut, prestation_nom, date_debut, date_fin, prix_total, acompte_montant, acompte_statut, montant_rembourse, stripe_payment_intent, token_gestion, clientes(prenom, nom, email, telephone), salons(nom, email_contact, couleur, telephone, adresse, stripe_account_id)";

type LigneRdv = {
  id: string;
  salon_id: string;
  statut: string;
  prestation_nom: string;
  date_debut: string;
  prix_total: number;
  acompte_montant: number;
  montant_rembourse: number;
  stripe_payment_intent: string | null;
  token_gestion: string;
  clientes: { prenom: string; nom: string; email: string; telephone: string } | null;
  salons: {
    nom: string;
    email_contact: string;
    couleur: string;
    telephone: string;
    adresse: string;
    stripe_account_id: string | null;
  } | null;
};

export async function chargerRdv(filtre: { id?: string; token?: string; paymentIntent?: string }) {
  let q = supabaseService().from("reservations").select(SELECT_RDV);
  if (filtre.id) q = q.eq("id", filtre.id);
  else if (filtre.token) q = q.eq("token_gestion", filtre.token);
  else if (filtre.paymentIntent) q = q.eq("stripe_payment_intent", filtre.paymentIntent);
  else throw new Error("Filtre manquant");
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error("Lecture du rendez-vous impossible.");
  return (data as unknown as LigneRdv) ?? null;
}

export function pourEmail(r: LigneRdv) {
  return {
    prestation_nom: r.prestation_nom,
    date_debut: r.date_debut,
    acompte_montant: Number(r.acompte_montant),
    prix_total: Number(r.prix_total),
    token_gestion: r.token_gestion,
    prenom: r.clientes?.prenom ?? "",
  };
}

/**
 * Paiement réussi (appelé par le webhook ET au retour de la cliente : le premier
 * arrivé l'enregistre, l'autre ne fait rien). Envoie les e-mails une seule fois.
 */
export async function paiementReussi(paymentIntentId: string, montantCentimes: number) {
  const { data, error } = await supabaseService().rpc("acompte_recu", {
    p_payment_intent: paymentIntentId,
    p_montant_centimes: montantCentimes,
  });
  if (error) throw new Error(error.message);
  const ligne = (data as { reservation_id: string; nouveau: boolean; a_rembourser: boolean }[] | null)?.[0];
  if (!ligne?.nouveau) return;

  const r = await chargerRdv({ id: ligne.reservation_id });
  if (!r?.salons || !r.clientes) return;

  if (ligne.a_rembourser) {
    // Payé trop tard : le créneau a été libéré, on rend l'argent tout de suite.
    const rendu = await rembourser(r, Number(r.acompte_montant), "paiement-tardif");
    await emailRefuseOuAnnule(r.salons, pourEmail(r), r.clientes.email, rendu ?? 0, true);
    return;
  }
  await Promise.all([
    emailDemandeRecue(r.salons, pourEmail(r), r.clientes.email),
    emailNouvelleDemande(r.salons, pourEmail(r), `${r.clientes.prenom} ${r.clientes.nom}`),
  ]);
}

/** Vérifie directement auprès de Stripe (au retour de la cliente, si le webhook tarde). */
export async function verifierPaiement(r: LigneRdv) {
  if (r.statut !== "en_attente_paiement" || !r.stripe_payment_intent || !r.salons?.stripe_account_id) return;
  const pi = await getStripe().paymentIntents.retrieve(r.stripe_payment_intent, undefined, {
    stripeAccount: r.salons.stripe_account_id,
  });
  if (pi.status === "succeeded") await paiementReussi(pi.id, pi.amount_received);
}

/**
 * Rembourse `montant` euros sur le compte Stripe du salon. Renvoie le montant
 * remboursé, ou null si Stripe a refusé. `motif` évite tout double remboursement
 * (double clic, page rechargée) : Stripe ne traite qu'une fois la même demande.
 */
export async function rembourser(
  r: Pick<LigneRdv, "id" | "acompte_montant" | "montant_rembourse" | "stripe_payment_intent" | "salons">,
  montant: number,
  motif: string,
): Promise<number | null> {
  const reste = Number(r.acompte_montant) - Number(r.montant_rembourse);
  const aRendre = Math.round(Math.min(montant, reste) * 100);
  if (aRendre < 1) return 0;
  if (!r.stripe_payment_intent || !r.salons?.stripe_account_id) return null;
  try {
    const remb = await getStripe().refunds.create(
      { payment_intent: r.stripe_payment_intent, amount: aRendre, metadata: { reservationId: r.id, motif } },
      { stripeAccount: r.salons.stripe_account_id, idempotencyKey: `remb-${r.id}-${motif}` },
    );
    const total = Math.round(Number(r.montant_rembourse) * 100) + remb.amount;
    await supabaseService().rpc("remboursement_enregistre", {
      p_payment_intent: r.stripe_payment_intent,
      p_total_centimes: total,
    });
    return remb.amount / 100;
  } catch (e) {
    console.error(`[remboursement] ${r.id} : ${messageStripe(e)}`);
    return null;
  }
}

/** E-mails envoyés après une décision du salon. */
export async function emailsDecision(r: LigneRdv, statut: string, rembourse: number) {
  if (!r.salons || !r.clientes) return;
  if (statut === "confirmee") await emailConfirme(r.salons, pourEmail(r), r.clientes.email);
  if (statut === "refusee" || statut === "annulee") {
    await emailRefuseOuAnnule(r.salons, pourEmail(r), r.clientes.email, rembourse, true);
  }
}
