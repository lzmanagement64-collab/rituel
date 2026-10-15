import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ajouterIndispo, chargerHoraires, enregistrerHoraires, supprimerIndispo } from "@/lib/pro.functions";
import { useEspace } from "@/components/pro/espace";
import { parisLongDate } from "@/lib/tz";

export const Route = createFileRoute("/pro/horaires")({ component: Horaires });

const NOMS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
const ORDRE = [1, 2, 3, 4, 5, 6, 0];

type Jour = {
  jour_semaine: number;
  ferme: boolean;
  heure_debut: string;
  heure_fin: string;
  pause_debut: string | null;
  pause_fin: string | null;
};

const defaut = (j: number): Jour => ({
  jour_semaine: j,
  ferme: j === 0,
  heure_debut: "09:00",
  heure_fin: "18:00",
  pause_debut: "12:30",
  pause_fin: "13:30",
});

const hm = (t: string | null) => (t ? t.slice(0, 5) : null);

function Horaires() {
  const { salon } = useEspace();
  const q = useQuery({ queryKey: ["horaires", salon.id], queryFn: () => chargerHoraires({ data: { salonId: salon.id } }) });
  const [jours, setJours] = useState<Jour[]>(() => Array.from({ length: 7 }, (_, j) => defaut(j)));
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    const lus = (q.data?.horaires ?? []) as Jour[];
    if (!lus.length) return;
    setJours(
      Array.from({ length: 7 }, (_, j) => {
        const l = lus.find((x) => x.jour_semaine === j);
        return l
          ? { ...l, heure_debut: hm(l.heure_debut)!, heure_fin: hm(l.heure_fin)!, pause_debut: hm(l.pause_debut), pause_fin: hm(l.pause_fin) }
          : defaut(j);
      }),
    );
  }, [q.data]);

  const maj = (j: number, champ: Partial<Jour>) => setJours((v) => v.map((x) => (x.jour_semaine === j ? { ...x, ...champ } : x)));

  async function enregistrer() {
    setEnvoi(true);
    try {
      await enregistrerHoraires({ data: { salonId: salon.id, jours } });
      toast.success("Horaires enregistrés.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <h1 className="text-3xl">Horaires</h1>
        <div className="carte divide-y">
          {ORDRE.map((j) => {
            const jour = jours[j];
            return (
              <div key={j} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <span className="w-24 font-medium">{NOMS[j]}</span>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={!jour.ferme} onChange={(e) => maj(j, { ferme: !e.target.checked })} className="size-4" />
                  Ouvert
                </label>
                {!jour.ferme && (
                  <>
                    <Heure valeur={jour.heure_debut} onChange={(v) => maj(j, { heure_debut: v })} libelle="Ouverture" />
                    <span>–</span>
                    <Heure valeur={jour.heure_fin} onChange={(v) => maj(j, { heure_fin: v })} libelle="Fermeture" />
                    <label className="ml-2 flex items-center gap-2 text-gris">
                      <input
                        type="checkbox"
                        checked={jour.pause_debut !== null}
                        onChange={(e) => maj(j, e.target.checked ? { pause_debut: "12:30", pause_fin: "13:30" } : { pause_debut: null, pause_fin: null })}
                        className="size-4"
                      />
                      Pause
                    </label>
                    {jour.pause_debut !== null && (
                      <>
                        <Heure valeur={jour.pause_debut} onChange={(v) => maj(j, { pause_debut: v })} libelle="Début de pause" />
                        <span>–</span>
                        <Heure valeur={jour.pause_fin ?? "13:30"} onChange={(v) => maj(j, { pause_fin: v })} libelle="Fin de pause" />
                      </>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
        <button className="btn-marque !py-2 text-sm" disabled={envoi} onClick={enregistrer}>
          {envoi ? "Enregistrement…" : "Enregistrer les horaires"}
        </button>
      </section>

      <Conges indispos={(q.data?.indisponibilites ?? []) as { id: string; date_debut: string; date_fin: string; motif: string }[]} onChange={() => q.refetch()} />
    </div>
  );
}

function Heure({ valeur, onChange, libelle }: { valeur: string; onChange: (v: string) => void; libelle: string }) {
  return <input type="time" aria-label={libelle} step={300} value={valeur} onChange={(e) => onChange(e.target.value)} className="rounded-lg border bg-white px-2 py-1" />;
}

function Conges({ indispos, onChange }: { indispos: { id: string; date_debut: string; date_fin: string; motif: string }[]; onChange: () => void }) {
  const { salon } = useEspace();
  const [debut, setDebut] = useState("");
  const [fin, setFin] = useState("");
  const [motif, setMotif] = useState("");

  async function ajouter(e: { preventDefault: () => void }) {
    e.preventDefault();
    try {
      await ajouterIndispo({ data: { salonId: salon.id, debut, fin: fin || debut, motif } });
      setDebut("");
      setFin("");
      setMotif("");
      onChange();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ajout impossible.");
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="text-2xl">Congés et absences</h2>
      <p className="text-sm text-gris">Aucun créneau ne sera proposé sur ces jours. Les rendez-vous déjà pris ne sont pas annulés.</p>
      <form onSubmit={ajouter} className="carte flex flex-wrap items-end gap-3 p-4 text-sm">
        <label>
          <span className="mb-1 block">Du</span>
          <input type="date" required value={debut} onChange={(e) => setDebut(e.target.value)} className="rounded-lg border bg-white px-2 py-1" />
        </label>
        <label>
          <span className="mb-1 block">Au</span>
          <input type="date" value={fin} min={debut} onChange={(e) => setFin(e.target.value)} className="rounded-lg border bg-white px-2 py-1" />
        </label>
        <label className="flex-1">
          <span className="mb-1 block">Motif (privé)</span>
          <input maxLength={120} value={motif} onChange={(e) => setMotif(e.target.value)} className="w-full rounded-lg border bg-white px-2 py-1" />
        </label>
        <button className="btn-marque !py-2 text-sm">Ajouter</button>
      </form>
      {indispos.map((i) => (
        <div key={i.id} className="flex items-center justify-between rounded-xl bg-lin px-4 py-2 text-sm">
          <span>
            Du <span className="capitalize">{parisLongDate(i.date_debut)}</span> au <span className="capitalize">{parisLongDate(i.date_fin)}</span>
            {i.motif && ` · ${i.motif}`}
          </span>
          <button
            className="text-gris underline"
            onClick={async () => {
              await supprimerIndispo({ data: { salonId: salon.id, id: i.id } });
              onChange();
            }}
          >
            Retirer
          </button>
        </div>
      ))}
    </section>
  );
}
