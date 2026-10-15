// Page d'accueil de Rituel (vitrine pour les salons).
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: Accueil });

const CONTACT = "mailto:lzmanagement64@gmail.com?subject=Rituel%20-%20je%20veux%20essayer";

const PROMESSES = [
  {
    titre: "Plus jamais de lapin",
    texte: "Chaque réservation est payée par un acompte, versé directement sur votre compte. Une absence ne vous coûte plus rien.",
  },
  {
    titre: "Vos clientes restent les vôtres",
    texte: "Une page de réservation à votre nom et à vos couleurs. Aucun salon concurrent affiché à côté de vous, jamais.",
  },
  {
    titre: "Zéro commission",
    texte: "Un abonnement fixe, toujours le même. Pas de pourcentage sur vos nouvelles clientes ni sur vos acomptes.",
  },
];

const SECURITE = [
  "Données hébergées en Europe",
  "Double authentification obligatoire pour accéder à l'agenda",
  "Chaque salon isolé des autres par la base de données elle-même",
  "Allergies et contre-indications chiffrées",
  "Aucune carte bancaire stockée chez nous",
  "Aucune donnée réelle dans nos environnements de test",
];

const FORMULES = [
  // « (bientôt) » : fonctions prévues mais pas encore livrées. Retirer la mention à la mise en service.
  { nom: "Essentiel", prix: 29, points: ["Page de réservation à votre marque", "Acompte obligatoire", "Agenda et fiches clientes", "E-mails de confirmation et d'annulation"] },
  { nom: "Pro", prix: 49, points: ["Tout Essentiel", "Rappels SMS inclus (bientôt)", "Relance fidélité automatique (bientôt)", "Demande d'avis Google (bientôt)"], phare: true },
  { nom: "Premium", prix: 79, points: ["Tout Pro", "Assistante IA qui répond et réserve dans vos DM Instagram et WhatsApp (bientôt)", "Plusieurs collaboratrices"] },
];

function Accueil() {
  return (
    <div>
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-5">
        <span className="font-display text-2xl">Rituel</span>
        <a href="/connexion" className="text-sm text-gris hover:text-encre">Espace pro</a>
      </header>

      <section className="mx-auto max-w-5xl px-4 pt-12 pb-20">
        <p className="surtitre">Pour les prothésistes ongulaires, techniciennes cils et esthéticiennes indépendantes</p>
        <h1 className="mt-4 max-w-3xl text-5xl leading-[1.05] sm:text-6xl">
          Le carnet de rendez-vous des indépendantes.
          <span className="block text-prune">Sans commission, sans lapin, sans fuite.</span>
        </h1>
        <p className="mt-6 max-w-xl text-lg text-gris">
          Vos clientes réservent depuis votre lien Instagram, paient un acompte, et vous validez d'un geste. L'argent arrive sur votre compte.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a href={CONTACT} className="btn-marque">Essayer 30 jours gratuitement</a>
          <a href="#tarifs" className="puce">Voir les tarifs</a>
        </div>
      </section>

      <section className="border-y bg-white">
        <div className="mx-auto grid max-w-5xl gap-8 px-4 py-16 sm:grid-cols-3">
          {PROMESSES.map((p) => (
            <div key={p.titre}>
              <h2 className="text-2xl">{p.titre}</h2>
              <p className="mt-2 text-gris">{p.texte}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-16">
        <p className="surtitre">Sécurité</p>
        <h2 className="mt-2 max-w-2xl text-4xl">Le fichier de vos clientes est votre bien le plus précieux. On le traite comme tel.</h2>
        <ul className="mt-8 grid gap-3 sm:grid-cols-2">
          {SECURITE.map((s) => (
            <li key={s} className="carte flex items-start gap-3 p-4">
              <span aria-hidden className="mt-1 size-2 shrink-0 rounded-full bg-succes" />
              {s}
            </li>
          ))}
        </ul>
        <p className="mt-6 text-sm text-gris">
          Vous pouvez exporter ou supprimer les données de vos clientes en un clic, à tout moment.
        </p>
      </section>

      <section id="tarifs" className="border-t bg-white">
        <div className="mx-auto max-w-5xl px-4 py-16">
          <p className="surtitre">Tarifs</p>
          <h2 className="mt-2 text-4xl">Un prix fixe. Zéro commission.</h2>
          <p className="mt-2 text-gris">Sans engagement. 30 jours d'essai gratuit. Prix hors taxes, par mois.</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {FORMULES.map((f) => (
              <div key={f.nom} className={`carte p-6 ${f.phare ? "ring-2 ring-prune" : ""}`}>
                <h3 className="text-2xl">{f.nom}</h3>
                <p className="mt-2">
                  <span className="font-display text-4xl">{f.prix} €</span>
                  <span className="text-gris"> / mois</span>
                </p>
                <ul className="mt-4 space-y-2 text-sm">
                  {f.points.map((p) => (
                    <li key={p}>· {p}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm text-gris">
            Les frais de paiement Stripe (environ 1,5 % + 0,25 € par carte européenne) sont prélevés par Stripe sur chaque acompte, comme pour tout paiement par carte.
          </p>
        </div>
      </section>

      <footer className="mx-auto max-w-5xl px-4 py-10 text-sm text-gris">
        <p>Rituel — un service LZ Management · Lons (64)</p>
      </footer>
    </div>
  );
}
