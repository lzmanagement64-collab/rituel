// Un rendez-vous dans l'espace pro, avec les actions autorisées pour son statut.
import { useState } from "react";
import { toast } from "sonner";
import { changerStatut } from "@/lib/pro.functions";
import { ACTIONS_SALON, LIBELLES_STATUT, euros, type Statut } from "@/lib/regles";
import { parisLongDate, parisTime } from "@/lib/tz";

export type Rdv = {
  id: string;
  statut: Statut;
  source: string;
  prestation_nom: string;
  date_debut: string;
  date_fin: string;
  prix_total: number;
  acompte_montant: number;
  acompte_statut: string;
  montant_rembourse: number;
  commentaire_cliente: string;
  note_interne: string;
  clientes: { prenom: string; nom: string; telephone: string; email: string } | null;
};

const COULEURS: Partial<Record<Statut, string>> = {
  a_valider: "bg-alerte/15 text-encre",
  confirmee: "bg-succes/15 text-encre",
  honoree: "bg-lin text-gris",
  absente: "bg-destructive/10 text-destructive",
  annulee: "bg-lin text-gris line-through",
  refusee: "bg-lin text-gris line-through",
};

export function CarteRdv({ rdv, salonId, avecDate = true, onChange }: { rdv: Rdv; salonId: string; avecDate?: boolean; onChange: () => void }) {
  const [envoi, setEnvoi] = useState<string | null>(null);
  const actions = ACTIONS_SALON[rdv.statut] ?? [];

  async function agir(statut: Statut, libelle: string) {
    const rembourse = statut === "refusee" || statut === "annulee";
    if (rembourse && !window.confirm(`${libelle} ? L'acompte de ${euros(rdv.acompte_montant)} sera remboursé à la cliente.`)) return;
    setEnvoi(statut);
    try {
      const res = await changerStatut({ data: { salonId, reservationId: rdv.id, statut: statut as "confirmee" } });
      if (res.echecRemboursement) toast.error("Statut changé, mais Stripe a refusé le remboursement : faites-le depuis votre tableau de bord Stripe.");
      else toast.success(res.rembourse > 0 ? `Fait. ${euros(res.rembourse)} remboursés.` : "Fait.");
      onChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action impossible.");
    } finally {
      setEnvoi(null);
    }
  }

  return (
    <article className="carte flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm text-gris">
          {avecDate && <span className="capitalize">{parisLongDate(rdv.date_debut)} · </span>}
          <strong className="text-encre">{parisTime(rdv.date_debut)}–{parisTime(rdv.date_fin)}</strong>
        </p>
        <p className="font-semibold">
          {rdv.clientes ? `${rdv.clientes.prenom} ${rdv.clientes.nom}` : "Cliente"} · {rdv.prestation_nom}
        </p>
        <p className="text-sm text-gris">
          {euros(rdv.prix_total)} · acompte {euros(rdv.acompte_montant)}{" "}
          {rdv.acompte_statut === "paye" && "payé"}
          {rdv.acompte_statut === "conserve" && "conservé"}
          {rdv.acompte_statut === "rembourse" && "remboursé"}
          {rdv.clientes?.telephone && (
            <>
              {" · "}
              <a className="underline" href={`tel:${rdv.clientes.telephone}`}>{rdv.clientes.telephone}</a>
            </>
          )}
        </p>
        {rdv.commentaire_cliente && <p className="mt-1 text-sm italic">« {rdv.commentaire_cliente} »</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${COULEURS[rdv.statut] ?? "bg-lin"}`}>{LIBELLES_STATUT[rdv.statut]}</span>
        {actions.map((a) => (
          <button
            key={a.statut}
            type="button"
            disabled={!!envoi}
            onClick={() => agir(a.statut, a.libelle)}
            className={a.statut === "confirmee" ? "btn-marque !px-4 !py-2 text-sm" : "puce !py-1.5 text-sm"}
          >
            {envoi === a.statut ? "…" : a.libelle}
          </button>
        ))}
      </div>
    </article>
  );
}
