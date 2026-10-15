// ============================================================
// « Mon rendez-vous » : page personnelle de la cliente (lien reçu par e-mail).
// Pas de compte, pas de mot de passe : le lien contient un jeton secret.
// ============================================================
import { createFileRoute, notFound } from "@tanstack/react-router";
import { useState, type CSSProperties } from "react";
import { annulerRendezVous, etatRendezVous } from "@/lib/reservation.functions";
import { euros, messageErreur } from "@/lib/regles";
import { parisLongDate, parisTime } from "@/lib/tz";

export const Route = createFileRoute("/rdv/$token")({
  loader: async ({ params }) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.token)) throw notFound();
    const r = await etatRendezVous({ data: { token: params.token } });
    if (!r) throw notFound();
    return r;
  },
  head: () => ({ meta: [{ title: "Mon rendez-vous" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: PageRdv,
});

const MESSAGES: Record<string, { titre: string; texte: string }> = {
  en_attente_paiement: {
    titre: "Paiement en cours de vérification",
    texte: "Dès que la banque confirme le paiement de l'acompte, votre demande est transmise au salon. Rechargez la page dans un instant.",
  },
  a_valider: {
    titre: "Demande envoyée au salon",
    texte: "Votre acompte est payé. Le salon va valider votre rendez-vous : vous recevrez un e-mail de confirmation.",
  },
  confirmee: { titre: "Rendez-vous confirmé", texte: "À bientôt ! Un e-mail récapitulatif vous a été envoyé." },
  refusee: { titre: "Rendez-vous non maintenu", texte: "Le salon n'a pas pu vous recevoir. Votre acompte vous est remboursé." },
  annulee: { titre: "Rendez-vous annulé", texte: "Ce rendez-vous est annulé." },
  honoree: { titre: "Merci de votre visite", texte: "Ce rendez-vous a eu lieu." },
  absente: { titre: "Rendez-vous manqué", texte: "Ce rendez-vous n'a pas été honoré." },
};

function PageRdv() {
  const initial = Route.useLoaderData();
  const { token } = Route.useParams();
  const [r, setR] = useState(initial);
  const [confirmer, setConfirmer] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const msg = MESSAGES[r.statut] ?? MESSAGES.annulee;

  const debut = new Date(r.date_debut).getTime();
  const limite = debut - r.salon.annulation_gratuite_heures * 3_600_000;
  const annulable = ["a_valider", "confirmee"].includes(r.statut) && debut > Date.now();
  const tardive = r.statut === "confirmee" && Date.now() > limite;

  async function annuler() {
    setEnvoi(true);
    try {
      const res = await annulerRendezVous({ data: { token } });
      setInfo(
        res.rembourse > 0
          ? `Rendez-vous annulé. Votre acompte de ${euros(res.rembourse)} vous est remboursé (5 à 10 jours).`
          : "Rendez-vous annulé. L'acompte reste acquis au salon, comme prévu dans les conditions.",
      );
      const maj = await etatRendezVous({ data: { token } });
      if (maj) setR(maj);
    } catch (e) {
      setInfo(messageErreur(e));
    } finally {
      setEnvoi(false);
      setConfirmer(false);
    }
  }

  return (
    <div style={{ "--marque": r.salon.couleur } as CSSProperties} className="min-h-screen">
      <main className="mx-auto max-w-lg space-y-5 px-4 py-10">
        <p className="surtitre">{r.salon.nom}</p>
        <h1 className="text-3xl">{msg.titre}</h1>
        <p className="text-gris">{msg.texte}</p>

        <div className="carte space-y-1 p-5">
          <p className="font-semibold">{r.prestation}</p>
          <p className="capitalize">
            {parisLongDate(r.date_debut)} à {parisTime(r.date_debut)}
          </p>
          <p className="text-sm text-gris">
            Prix : {euros(r.prix_total)} · Acompte payé : {euros(r.acompte)}
            {r.rembourse > 0 && ` · Remboursé : ${euros(r.rembourse)}`}
          </p>
          {r.salon.adresse && <p className="pt-2 text-sm">{r.salon.adresse}</p>}
          {r.salon.telephone && (
            <p className="text-sm">
              <a className="underline" href={`tel:${r.salon.telephone}`}>{r.salon.telephone}</a>
            </p>
          )}
        </div>

        {info && <p role="status" className="rounded-xl bg-lin p-3 text-sm">{info}</p>}

        {annulable && !confirmer && (
          <button type="button" className="text-sm text-gris underline" onClick={() => setConfirmer(true)}>
            Annuler ce rendez-vous
          </button>
        )}
        {annulable && confirmer && (
          <div className="carte space-y-3 p-5 text-sm">
            <p>
              {tardive
                ? "Le délai d'annulation gratuite est dépassé : l'acompte restera acquis au salon."
                : "Votre acompte vous sera remboursé intégralement."}
            </p>
            <div className="flex gap-2">
              <button type="button" className="btn-marque" disabled={envoi} onClick={annuler}>
                {envoi ? "Annulation…" : "Confirmer l'annulation"}
              </button>
              <button type="button" className="puce" onClick={() => setConfirmer(false)}>
                Garder mon rendez-vous
              </button>
            </div>
          </div>
        )}

        {r.salon.slug && ["refusee", "annulee", "honoree"].includes(r.statut) && (
          <a className="btn-marque" href={`/r/${r.salon.slug}`}>
            Reprendre rendez-vous
          </a>
        )}

        <p className="pt-6 text-xs text-gris">
          Sécurité : {r.salon.nom} ne vous demandera jamais de payer par SMS ou par un lien reçu ailleurs que sur cette page.
        </p>
      </main>
    </div>
  );
}
