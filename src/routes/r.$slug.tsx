// ============================================================
// Page de réservation d'un salon : rituel.app/r/<adresse-du-salon>
// Lien à mettre dans la bio Instagram, sur Google et sur le site du salon.
// Aux couleurs du salon. Jamais de salon concurrent affiché.
// ============================================================
import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { chargerCreneaux, chargerSalon, reserver } from "@/lib/reservation.functions";
import { duree, euros, messageErreur } from "@/lib/regles";
import { parisDateISO, parisLongDate } from "@/lib/tz";
import { Paiement } from "@/components/reservation/Paiement";

export const Route = createFileRoute("/r/$slug")({
  loader: async ({ params }) => {
    if (!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(params.slug)) throw notFound();
    const res = await chargerSalon({ data: { slug: params.slug } });
    if (!res) throw notFound();
    return res;
  },
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          { title: `Réserver chez ${loaderData.salon.nom}${loaderData.salon.ville ? ` — ${loaderData.salon.ville}` : ""}` },
          {
            name: "description",
            content: `${loaderData.salon.metier}${loaderData.salon.ville ? ` à ${loaderData.salon.ville}` : ""}. Réservez en ligne en quelques secondes.`,
          },
        ]
      : [],
  }),
  component: PageReservation,
});

type Etape = "prestation" | "creneau" | "coordonnees" | "paiement";

function prochainsJours(n: number): string[] {
  const jours: string[] = [];
  const maintenant = Date.now();
  for (let i = 0; i < n; i++) jours.push(parisDateISO(new Date(maintenant + i * 86_400_000)));
  return jours;
}

function PageReservation() {
  const { salon, prestations, reservable } = Route.useLoaderData();
  const navigate = useNavigate();
  const [etape, setEtape] = useState<Etape>("prestation");
  const [prestationId, setPrestationId] = useState<string | null>(null);
  const [jour, setJour] = useState<string | null>(null);
  const [heure, setHeure] = useState<string | null>(null);
  const [creneaux, setCreneaux] = useState<string[] | null>(null);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [paiement, setPaiement] = useState<Awaited<ReturnType<typeof reserver>> | null>(null);
  const [nbJours, setNbJours] = useState(14);

  const prestation = prestations.find((p) => p.id === prestationId) ?? null;
  const jours = useMemo(() => prochainsJours(Math.min(nbJours, salon.horizon_jours + 1)), [nbJours, salon.horizon_jours]);
  const style = { "--marque": salon.couleur } as CSSProperties;
  const enLigne = salon.ouvert && salon.paiements_actifs && reservable;

  useEffect(() => {
    if (!prestationId || !jour) return;
    let annule = false;
    setCreneaux(null);
    setHeure(null);
    chargerCreneaux({ data: { slug: salon.slug, prestationId, date: jour } })
      .then((c) => !annule && setCreneaux(c))
      .catch(() => !annule && setCreneaux([]));
    return () => {
      annule = true;
    };
  }, [prestationId, jour, salon.slug]);

  async function envoyer(form: HTMLFormElement) {
    if (!prestationId || !jour || !heure) return;
    const f = new FormData(form);
    setChargement(true);
    setErreur(null);
    try {
      const res = await reserver({
        data: {
          slug: salon.slug,
          prestationId,
          date: jour,
          heure,
          prenom: String(f.get("prenom") ?? ""),
          nom: String(f.get("nom") ?? ""),
          email: String(f.get("email") ?? ""),
          telephone: String(f.get("telephone") ?? ""),
          commentaire: String(f.get("commentaire") ?? ""),
          conditions: f.get("conditions") === "on",
          site: String(f.get("site") ?? ""),
        },
      });
      setPaiement(res);
      setEtape("paiement");
    } catch (e) {
      const msg = messageErreur(e, e instanceof Error ? e.message : "Réservation impossible.");
      setErreur(msg);
      if (msg.includes("vient d'être réservé")) {
        setEtape("creneau");
        setHeure(null);
        setCreneaux(null);
        if (prestationId && jour) {
          chargerCreneaux({ data: { slug: salon.slug, prestationId, date: jour } }).then(setCreneaux);
        }
      }
    } finally {
      setChargement(false);
    }
  }

  return (
    <div style={style} className="min-h-screen">
      <header className="border-b bg-white/70">
        <div className="mx-auto max-w-2xl px-4 py-6">
          <p className="surtitre">{salon.metier}{salon.ville ? ` · ${salon.ville}` : ""}</p>
          <h1 className="mt-1 text-3xl text-encre">{salon.nom}</h1>
          {salon.description && <p className="mt-2 text-sm text-gris">{salon.description}</p>}
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-6 px-4 py-8">
        {!enLigne && (
          <div className="carte p-5 text-sm">
            <p className="font-semibold">La réservation en ligne n'est pas disponible pour le moment.</p>
            {salon.telephone && (
              <p className="mt-1 text-gris">
                Contactez le salon au <a className="underline" href={`tel:${salon.telephone}`}>{salon.telephone}</a>.
              </p>
            )}
          </div>
        )}

        {enLigne && (
          <>
            <Etapes etape={etape} />

            {etape === "prestation" && (
              <section className="space-y-3" aria-label="Choix de la prestation">
                <h2 className="text-xl">Quelle prestation ?</h2>
                {prestations.length === 0 && <p className="text-gris">Aucune prestation disponible.</p>}
                {prestations.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setPrestationId(p.id);
                      setJour(null);
                      setEtape("creneau");
                    }}
                    className="carte flex w-full items-start justify-between gap-4 p-4 text-left transition hover:border-marque"
                  >
                    <span>
                      <span className="block font-semibold">{p.nom}</span>
                      {p.description && <span className="mt-0.5 block text-sm text-gris">{p.description}</span>}
                      <span className="mt-1 block text-xs text-gris">{duree(p.duree_minutes)} · acompte {euros(p.acompte)}</span>
                    </span>
                    <span className="shrink-0 font-semibold">{euros(p.prix)}</span>
                  </button>
                ))}
              </section>
            )}

            {etape === "creneau" && prestation && (
              <section className="space-y-5" aria-label="Choix du créneau">
                <Retour onClick={() => setEtape("prestation")} />
                <div>
                  <h2 className="text-xl">Quel jour ?</h2>
                  <p className="text-sm text-gris">{prestation.nom} · {duree(prestation.duree_minutes)}</p>
                </div>
                <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2">
                  {jours.map((d) => (
                    <button key={d} type="button" className="puce shrink-0 flex-col !py-2" aria-pressed={jour === d} onClick={() => setJour(d)}>
                      <span className="text-xs capitalize">{new Intl.DateTimeFormat("fr-FR", { weekday: "short", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`))}</span>
                      <span className="text-base font-semibold">{Number(d.slice(8))}</span>
                    </button>
                  ))}
                  {nbJours <= salon.horizon_jours && (
                    <button type="button" className="puce shrink-0" onClick={() => setNbJours((n) => n + 14)}>
                      Plus tard
                    </button>
                  )}
                </div>

                {jour && (
                  <div>
                    <h3 className="mb-3 text-lg capitalize">{parisLongDate(`${jour}T12:00:00Z`)}</h3>
                    {creneaux === null && <p className="text-sm text-gris">Recherche des créneaux…</p>}
                    {creneaux?.length === 0 && <p className="text-sm text-gris">Aucun créneau libre ce jour-là.</p>}
                    <div className="flex flex-wrap gap-2">
                      {creneaux?.map((h) => (
                        <button key={h} type="button" className="puce" aria-pressed={heure === h} onClick={() => setHeure(h)}>
                          {h.replace(":", " h ")}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {erreur && <p role="alert" className="text-sm text-destructive">{erreur}</p>}
                <button type="button" className="btn-marque w-full" disabled={!heure} onClick={() => { setErreur(null); setEtape("coordonnees"); }}>
                  Continuer
                </button>
              </section>
            )}

            {etape === "coordonnees" && prestation && jour && heure && (
              <section className="space-y-5" aria-label="Vos coordonnées">
                <Retour onClick={() => setEtape("creneau")} />
                <Resume prestation={prestation} jour={jour} heure={heure} />
                <form
                  className="space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    envoyer(e.currentTarget);
                  }}
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Champ nom="prenom" libelle="Prénom" auto="given-name" />
                    <Champ nom="nom" libelle="Nom" auto="family-name" />
                  </div>
                  <Champ nom="email" libelle="E-mail" type="email" auto="email" />
                  <Champ nom="telephone" libelle="Téléphone" type="tel" auto="tel" />
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium">Un mot pour le salon (facultatif)</span>
                    <textarea name="commentaire" maxLength={500} rows={2} className="w-full rounded-xl border bg-white px-3 py-2" />
                  </label>
                  {/* Champ piège anti-robots, invisible pour les humains */}
                  <input type="text" name="site" tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 opacity-0" />
                  <label className="flex items-start gap-3 text-sm">
                    <input type="checkbox" name="conditions" required className="mt-1 size-4 accent-marque" />
                    <span>
                      J'accepte de payer un acompte de {euros(prestation.acompte)}, déduit du prix final.
                      {salon.annulation_gratuite_heures > 0
                        ? ` Annulation gratuite jusqu'à ${salon.annulation_gratuite_heures} h avant le rendez-vous ; ensuite, l'acompte reste acquis au salon.`
                        : " L'acompte reste acquis au salon en cas d'annulation une fois le rendez-vous confirmé."}
                      {" "}Si le salon ne peut pas me recevoir, l'acompte m'est remboursé.
                    </span>
                  </label>
                  <p className="text-xs text-gris">
                    Vos coordonnées servent uniquement à gérer ce rendez-vous avec {salon.nom}. Elles sont hébergées en
                    Europe et ne sont jamais revendues ni partagées.
                  </p>
                  {erreur && <p role="alert" className="text-sm text-destructive">{erreur}</p>}
                  <button type="submit" className="btn-marque w-full" disabled={chargement}>
                    {chargement ? "Un instant…" : "Passer au paiement de l'acompte"}
                  </button>
                </form>
              </section>
            )}

            {etape === "paiement" && paiement && prestation && jour && heure && (
              <section className="space-y-5" aria-label="Paiement de l'acompte">
                <Resume prestation={prestation} jour={jour} heure={heure} />
                <div className="carte p-5">
                  <Paiement
                    clePublique={paiement.clePublique}
                    compteStripe={paiement.compteStripe}
                    clientSecret={paiement.clientSecret}
                    acompte={paiement.acompte}
                    couleur={salon.couleur}
                    retourUrl={`${typeof window !== "undefined" ? window.location.origin : ""}/rdv/${paiement.token}`}
                    onPaye={() => navigate({ to: "/rdv/$token", params: { token: paiement.token } })}
                  />
                </div>
              </section>
            )}
          </>
        )}

        <footer className="pt-8 text-center text-xs text-gris">
          {salon.instagram && (
            <p className="mt-1">
              <a className="underline" href={`https://instagram.com/${salon.instagram.replace(/^@/, "")}`} rel="noopener noreferrer" target="_blank">
                @{salon.instagram.replace(/^@/, "")}
              </a>
            </p>
          )}
          <p className="mt-4">Réservation sécurisée avec Rituel</p>
        </footer>
      </main>
    </div>
  );
}

function Etapes({ etape }: { etape: Etape }) {
  const liste: [Etape, string][] = [
    ["prestation", "Prestation"],
    ["creneau", "Créneau"],
    ["coordonnees", "Coordonnées"],
    ["paiement", "Acompte"],
  ];
  const index = liste.findIndex(([e]) => e === etape);
  return (
    <ol className="flex gap-2 text-xs" aria-label="Étapes">
      {liste.map(([e, libelle], i) => (
        <li key={e} className={`flex-1 border-t-2 pt-2 ${i <= index ? "border-marque text-encre" : "border-border text-gris"}`} aria-current={i === index ? "step" : undefined}>
          {libelle}
        </li>
      ))}
    </ol>
  );
}

function Resume({ prestation, jour, heure }: { prestation: { nom: string; prix: number; acompte: number; duree_minutes: number }; jour: string; heure: string }) {
  return (
    <div className="carte p-4 text-sm">
      <p className="font-semibold">{prestation.nom}</p>
      <p className="capitalize">{parisLongDate(`${jour}T12:00:00Z`)} à {heure.replace(":", " h ")}</p>
      <p className="text-gris">{duree(prestation.duree_minutes)} · {euros(prestation.prix)} · acompte {euros(prestation.acompte)}</p>
    </div>
  );
}

function Champ({ nom, libelle, type = "text", auto }: { nom: string; libelle: string; type?: string; auto?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{libelle}</span>
      <input name={nom} type={type} required autoComplete={auto} maxLength={160} className="w-full rounded-xl border bg-white px-3 py-2.5" />
    </label>
  );
}

function Retour({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-sm text-gris underline-offset-4 hover:underline">
      ← Retour
    </button>
  );
}
