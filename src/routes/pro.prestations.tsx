import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { chargerPrestations, enregistrerPrestation } from "@/lib/pro.functions";
import { useEspace } from "@/components/pro/espace";
import { calculerAcompte, duree, euros } from "@/lib/regles";

export const Route = createFileRoute("/pro/prestations")({ component: Prestations });

type Prestation = {
  id?: string;
  nom: string;
  description: string;
  duree_minutes: number;
  prix: number;
  acompte_fixe: number | null;
  actif: boolean;
  ordre: number;
};

const VIDE: Prestation = { nom: "", description: "", duree_minutes: 60, prix: 0, acompte_fixe: null, actif: true, ordre: 0 };

function Prestations() {
  const { salon } = useEspace();
  const q = useQuery({ queryKey: ["prestations", salon.id], queryFn: () => chargerPrestations({ data: { salonId: salon.id } }) });
  const [edition, setEdition] = useState<Prestation | null>(null);
  const liste = (q.data ?? []) as Prestation[];

  async function enregistrer(p: Prestation) {
    try {
      await enregistrerPrestation({ data: { ...p, salonId: salon.id, acompte_fixe: p.acompte_fixe || null } });
      toast.success("Prestation enregistrée.");
      setEdition(null);
      q.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Enregistrement impossible.");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl">Prestations</h1>
        <button className="btn-marque !py-2 text-sm" onClick={() => setEdition({ ...VIDE, ordre: liste.length })}>
          Ajouter
        </button>
      </div>
      {edition && <Formulaire initial={edition} pourcent={salon.acompte_pourcent} onAnnuler={() => setEdition(null)} onValider={enregistrer} />}
      <div className="space-y-2">
        {liste.map((p) => (
          <div key={p.id} className={`carte flex items-center justify-between gap-4 p-4 ${p.actif ? "" : "opacity-50"}`}>
            <div>
              <p className="font-semibold">{p.nom}{!p.actif && " (masquée)"}</p>
              <p className="text-sm text-gris">
                {duree(p.duree_minutes)} · {euros(p.prix)} · acompte {euros(calculerAcompte(Number(p.prix), salon.acompte_pourcent, p.acompte_fixe))}
              </p>
            </div>
            <button className="puce !py-1.5 text-sm" onClick={() => setEdition({ ...p, prix: Number(p.prix), acompte_fixe: p.acompte_fixe ? Number(p.acompte_fixe) : null })}>
              Modifier
            </button>
          </div>
        ))}
        {!q.isLoading && liste.length === 0 && !edition && <p className="text-gris">Ajoutez votre première prestation.</p>}
      </div>
    </div>
  );
}

function Formulaire({ initial, pourcent, onAnnuler, onValider }: { initial: Prestation; pourcent: number; onAnnuler: () => void; onValider: (p: Prestation) => void }) {
  const [p, setP] = useState(initial);
  const maj = (champ: Partial<Prestation>) => setP((v) => ({ ...v, ...champ }));
  return (
    <form
      className="carte grid gap-4 p-5 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        onValider(p);
      }}
    >
      <label className="text-sm sm:col-span-2">
        <span className="mb-1 block font-medium">Nom</span>
        <input required minLength={2} maxLength={80} value={p.nom} onChange={(e) => maj({ nom: e.target.value })} className="w-full rounded-xl border bg-white px-3 py-2" />
      </label>
      <label className="text-sm sm:col-span-2">
        <span className="mb-1 block font-medium">Description (facultatif)</span>
        <input maxLength={300} value={p.description} onChange={(e) => maj({ description: e.target.value })} className="w-full rounded-xl border bg-white px-3 py-2" />
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-medium">Durée (minutes)</span>
        <input type="number" min={5} max={600} step={5} required value={p.duree_minutes} onChange={(e) => maj({ duree_minutes: Number(e.target.value) })} className="w-full rounded-xl border bg-white px-3 py-2" />
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-medium">Prix (€)</span>
        <input type="number" min={0} max={5000} step="0.5" required value={p.prix} onChange={(e) => maj({ prix: Number(e.target.value) })} className="w-full rounded-xl border bg-white px-3 py-2" />
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-medium">Acompte fixe (€, facultatif)</span>
        <input type="number" min={1} step="0.5" value={p.acompte_fixe ?? ""} placeholder={`${pourcent} % par défaut`} onChange={(e) => maj({ acompte_fixe: e.target.value ? Number(e.target.value) : null })} className="w-full rounded-xl border bg-white px-3 py-2" />
      </label>
      <label className="flex items-center gap-2 self-end text-sm">
        <input type="checkbox" checked={p.actif} onChange={(e) => maj({ actif: e.target.checked })} className="size-4" />
        Proposée en ligne
      </label>
      <p className="text-sm text-gris sm:col-span-2">Acompte demandé : {euros(calculerAcompte(p.prix, pourcent, p.acompte_fixe))}</p>
      <div className="flex gap-2 sm:col-span-2">
        <button className="btn-marque !py-2 text-sm">Enregistrer</button>
        <button type="button" className="puce" onClick={onAnnuler}>Annuler</button>
      </div>
    </form>
  );
}
