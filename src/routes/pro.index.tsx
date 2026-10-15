import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { chargerAgenda, chargerTableauDeBord } from "@/lib/pro.functions";
import { useEspace } from "@/components/pro/espace";
import { CarteRdv, type Rdv } from "@/components/pro/CarteRdv";
import { euros } from "@/lib/regles";
import { parisDateISO } from "@/lib/tz";

export const Route = createFileRoute("/pro/")({ component: Accueil });

function Accueil() {
  const { salon } = useEspace();
  const aujourdhui = parisDateISO(new Date());
  const tdb = useQuery({ queryKey: ["tdb", salon.id], queryFn: () => chargerTableauDeBord({ data: { salonId: salon.id } }) });
  const jour = useQuery({
    queryKey: ["agenda", salon.id, aujourdhui, aujourdhui],
    queryFn: () => chargerAgenda({ data: { salonId: salon.id, debut: aujourdhui, fin: aujourdhui } }),
  });
  const recharger = () => {
    tdb.refetch();
    jour.refetch();
  };
  const lien = typeof window !== "undefined" ? `${window.location.origin}/r/${salon.slug}` : `/r/${salon.slug}`;
  const aValider = (tdb.data?.aValider ?? []) as Rdv[];
  const duJour = ((jour.data ?? []) as Rdv[]).filter((r) => ["confirmee", "honoree", "absente"].includes(r.statut));

  return (
    <div className="space-y-10">
      <section className="grid gap-3 sm:grid-cols-4">
        <Stat libelle="Chiffre d'affaires du mois" valeur={euros(tdb.data?.stats.chiffreAffaires ?? 0)} />
        <Stat libelle="Rendez-vous honorés" valeur={String(tdb.data?.stats.rendezVous ?? 0)} />
        <Stat libelle="Acomptes gardés (lapins, annulations tardives)" valeur={euros(tdb.data?.stats.acomptesConserves ?? 0)} />
        <Stat libelle="Absences" valeur={String(tdb.data?.stats.absentes ?? 0)} />
      </section>

      <section>
        <h2 className="mb-3 text-2xl">À valider</h2>
        {tdb.isLoading && <p className="text-gris">Chargement…</p>}
        {!tdb.isLoading && aValider.length === 0 && <p className="text-gris">Aucune demande en attente.</p>}
        <div className="space-y-3">
          {aValider.map((r) => (
            <CarteRdv key={r.id} rdv={r} salonId={salon.id} onChange={recharger} />
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-2xl">Aujourd'hui</h2>
          <Link to="/pro/agenda" className="text-sm underline">Tout l'agenda</Link>
        </div>
        {duJour.length === 0 && <p className="text-gris">Pas de rendez-vous aujourd'hui.</p>}
        <div className="space-y-3">
          {duJour.map((r) => (
            <CarteRdv key={r.id} rdv={r} salonId={salon.id} avecDate={false} onChange={recharger} />
          ))}
        </div>
      </section>

      <section className="carte p-5">
        <h2 className="text-xl">Votre lien de réservation</h2>
        <p className="mt-1 text-sm text-gris">À mettre dans votre bio Instagram, sur Google et sur WhatsApp.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <code className="rounded-lg bg-lin px-3 py-2 text-sm">{lien}</code>
          <button
            type="button"
            className="puce"
            onClick={() => navigator.clipboard?.writeText(lien)}
          >
            Copier
          </button>
          <a className="puce" href={`/r/${salon.slug}`} target="_blank" rel="noreferrer">Voir la page</a>
        </div>
      </section>
    </div>
  );
}

function Stat({ libelle, valeur }: { libelle: string; valeur: string }) {
  return (
    <div className="carte p-4">
      <p className="text-xs text-gris">{libelle}</p>
      <p className="mt-1 font-display text-2xl">{valeur}</p>
    </div>
  );
}
