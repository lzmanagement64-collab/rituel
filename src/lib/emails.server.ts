// ============================================================
// E-mails transactionnels (Resend).
// Secrets : RESEND_API_KEY, RESEND_FROM (ex. « Rituel <rdv@rituel.app> »).
// Les réponses des clientes partent vers l'adresse du salon (reply_to).
// Anti-hameçonnage : chaque e-mail rappelle que le salon ne demande
// jamais de paiement par SMS ou par lien envoyé hors de Rituel.
// ============================================================
import { adresseSite, lireSecret } from "./secrets.server";
import { euros } from "./regles";
import { parisLongDate, parisTime } from "./tz";

type SalonEmail = { nom: string; email_contact: string; couleur: string; telephone?: string; adresse?: string };
type RdvEmail = {
  prestation_nom: string;
  date_debut: string;
  acompte_montant: number;
  prix_total: number;
  token_gestion: string;
  prenom: string;
};

const echapper = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export async function envoyerEmail(e: { to: string; subject: string; html: string; replyTo?: string }) {
  const cle = lireSecret("RESEND_API_KEY");
  const from = lireSecret("RESEND_FROM") || "Rituel <onboarding@resend.dev>";
  if (!cle) {
    console.warn(`[email] RESEND_API_KEY absente : e-mail non envoyé (${e.subject})`);
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cle}` },
      body: JSON.stringify({
        from,
        to: [e.to],
        subject: e.subject,
        html: e.html,
        ...(e.replyTo ? { reply_to: e.replyTo } : {}),
      }),
    });
    if (!res.ok) console.error(`[email] Resend a refusé l'envoi (${res.status})`);
    return res.ok;
  } catch (err) {
    console.error("[email] Resend injoignable", err);
    return false;
  }
}

function gabarit(salon: SalonEmail, titre: string, corps: string, avecAvertissement = true) {
  const couleur = /^#[0-9a-fA-F]{6}$/.test(salon.couleur) ? salon.couleur : "#7a4b5c";
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#f7f3ee;font-family:Helvetica,Arial,sans-serif;color:#2b2226">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="background:${couleur};color:#ffffff;padding:20px 28px;font-size:18px;font-weight:bold">${echapper(salon.nom)}</td></tr>
<tr><td style="padding:28px">
<h1 style="font-size:20px;margin:0 0 16px">${echapper(titre)}</h1>
${corps}
${
  avecAvertissement
    ? `<p style="font-size:12px;color:#7a6e72;border-top:1px solid #eee;padding-top:16px;margin-top:24px">
Sécurité : ${echapper(salon.nom)} ne vous demandera jamais de payer par SMS, WhatsApp ou par un lien reçu ailleurs que dans cet e-mail. En cas de doute, contactez le salon directement.</p>`
    : ""
}
</td></tr></table>
<p style="font-size:11px;color:#9a8f93;margin-top:16px">Réservation gérée avec Rituel</p>
</td></tr></table></body></html>`;
}

function blocRdv(r: RdvEmail) {
  return `<table role="presentation" style="width:100%;background:#faf7f4;border-radius:12px;padding:16px;font-size:15px">
<tr><td><strong>${echapper(r.prestation_nom)}</strong></td></tr>
<tr><td>${echapper(parisLongDate(r.date_debut))} à ${echapper(parisTime(r.date_debut))}</td></tr>
<tr><td style="color:#7a6e72">Acompte : ${euros(r.acompte_montant)} · Prix total : ${euros(r.prix_total)}</td></tr>
</table>`;
}

const lienGestion = (r: RdvEmail) => `${adresseSite()}/rdv/${r.token_gestion}`;
const bouton = (href: string, texte: string, couleur: string) =>
  `<p style="margin:24px 0"><a href="${href}" style="background:${couleur};color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:bold">${echapper(texte)}</a></p>`;

export function emailDemandeRecue(salon: SalonEmail, r: RdvEmail, to: string) {
  return envoyerEmail({
    to,
    replyTo: salon.email_contact,
    subject: `Demande reçue — ${salon.nom}`,
    html: gabarit(
      salon,
      `Merci ${r.prenom}, votre demande est bien reçue`,
      `<p>Votre acompte est payé. ${echapper(salon.nom)} va valider votre rendez-vous et vous recevrez un e-mail de confirmation.</p>
${blocRdv(r)}${bouton(lienGestion(r), "Voir ou annuler mon rendez-vous", salon.couleur)}`,
    ),
  });
}

export function emailNouvelleDemande(salon: SalonEmail, r: RdvEmail, cliente: string) {
  return envoyerEmail({
    to: salon.email_contact,
    subject: `Nouvelle demande à valider — ${cliente}`,
    html: gabarit(
      salon,
      "Nouvelle demande de rendez-vous",
      `<p>${echapper(cliente)} a réservé et payé son acompte.</p>${blocRdv(r)}
${bouton(`${adresseSite()}/pro`, "Valider ou refuser", salon.couleur)}`,
      false,
    ),
  });
}

export function emailConfirme(salon: SalonEmail, r: RdvEmail, to: string) {
  const lieu = salon.adresse ? `<p>Adresse : ${echapper(salon.adresse)}</p>` : "";
  return envoyerEmail({
    to,
    replyTo: salon.email_contact,
    subject: `Rendez-vous confirmé — ${salon.nom}`,
    html: gabarit(
      salon,
      "Votre rendez-vous est confirmé",
      `${blocRdv(r)}${lieu}${bouton(lienGestion(r), "Voir ou annuler mon rendez-vous", salon.couleur)}`,
    ),
  });
}

export function emailRefuseOuAnnule(salon: SalonEmail, r: RdvEmail, to: string, rembourse: number, parLeSalon: boolean) {
  const titre = parLeSalon ? "Votre rendez-vous n'a pas pu être maintenu" : "Votre rendez-vous est annulé";
  const remb =
    rembourse > 0
      ? `<p>Votre acompte de ${euros(rembourse)} vous est remboursé. Il apparaîtra sur votre compte sous 5 à 10 jours.</p>`
      : `<p>Conformément aux conditions d'annulation acceptées lors de la réservation, l'acompte reste acquis au salon.</p>`;
  return envoyerEmail({
    to,
    replyTo: salon.email_contact,
    subject: `${titre} — ${salon.nom}`,
    html: gabarit(salon, titre, `${blocRdv(r)}${remb}`),
  });
}

export function emailAnnulationAuSalon(salon: SalonEmail, r: RdvEmail, cliente: string) {
  return envoyerEmail({
    to: salon.email_contact,
    subject: `Annulation — ${cliente}`,
    html: gabarit(salon, `${cliente} a annulé son rendez-vous`, blocRdv(r), false),
  });
}
