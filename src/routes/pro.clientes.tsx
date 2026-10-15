import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  chargerClientes,
  chargerHistoriqueCliente,
  enregistrerNotes,
  enregistrerSante,
  exporterClientes,
  lireSante,
  supprimerCliente,
} from "@/lib/pro.functions";
import { useEspace } from "@/components/pro/espace";
import { LIBELLES_STATUT, euros, type Statut } from "@/lib/regles";
import { parisLongDate } from "@/lib/tz";

export const Route = createFileRoute("/pro/clientes")({ component: Clientes });

type Cliente = {
  id: string;
  prenom: string;
  nom: string;
  email: string;
  telephone: string;
  notes_privees: string;
  sante_consentement_le: string | null;
  derniere_activite_le: string;
};

function Clientes() {
  const { salon, role } = useEspace();
  const q = useQuery({ queryKey: ["clientes", salon.id], queryFn: () => chargerClientes({ data: { salonId: salon.id } }) });
  const [recherche, setRecherche] = useState("");
  const [ouverte, setOuverte] = useState<string | null>(null);
  const liste = ((q.data ?? []) as Cliente[]).filter((c) =>
    `${c.prenom} ${c.nom} ${c.email} ${c.telephone}`.toLowerCase().includes(recherche.toLowerCase()),
  );

  async function exporter() {
    try {
      const { csv } = await exporterClientes({ data: { salonId: salon.id } });
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `clientes-${salon.slug}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export impossible.");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl">Clientes</h1>
        <div className="flex gap-2">
          <input placeholder="Rechercher" value={recherche} onChange={(e) => setRecherche(e.target.value)} className="rounded-full border bg-white px-4 py-2 text-sm" />
          {role === "proprietaire" && <button className="puce text-sm" onClick={exporter}>Exporter (CSV)</button>}
        </div>
      </div>
      {q.isLoading && <p className="text-gris">Chargement…</p>}
      <div className="space-y-2">
        {liste.map((c) => (
          <div key={c.id} className="carte">
            <button className="flex w-full items-center justify-between p-4 text-left" onClick={() => setOuverte(ouverte === c.id ? null : c.id)} aria-expanded={ouverte === c.id}>
              <span>
                <span className="block font-semibold">{c.prenom} {c.nom}</span>
                <span className="text-sm text-gris">{c.telephone} · {c.email}</span>
              </span>
              <span className="text-gris">{ouverte === c.id ? "−" : "+"}</span>
            </button>
            {ouverte === c.id && <Fiche cliente={c} onChange={() => q.refetch()} />}
          </div>
        ))}
        {!q.isLoading && liste.length === 0 && <p className="text-gris">Aucune cliente.</p>}
      </div>
    </div>
  );
}

function Fiche({ cliente, onChange }: { cliente: Cliente; onChange: () => void }) {
  const { salon, role } = useEspace();
  const [notes, setNotes] = useState(cliente.notes_privees);
  const [sante, setSante] = useState<string | null>(null);
  const [consentement, setConsentement] = useState(false);
  const historique = useQuery({
    queryKey: ["historique", cliente.id],
    queryFn: () => chargerHistoriqueCliente({ data: { salonId: salon.id, clienteId: cliente.id } }),
  });

  return (
    <div className="space-y-5 border-t p-4 text-sm">
      <div>
        <p className="mb-1 font-medium">Notes privées</p>
        <textarea value={notes} maxLength={2000} rows={3} onChange={(e) => setNotes(e.target.value)} className="w-full rounded-xl border bg-white px-3 py-2" />
        <button
          className="puce mt-2 !py-1.5"
          onClick={async () => {
            await enregistrerNotes({ data: { salonId: salon.id, clienteId: cliente.id, notes_privees: notes } });
            toast.success("Notes enregistrées.");
          }}
        >
          Enregistrer les notes
        </button>
      </div>

      <div className="rounded-xl bg-lin p-3">
        <p className="font-medium">Allergies et contre-indications</p>
        <p className="text-xs text-gris">Donnée de santé : chiffrée, visible uniquement par votre salon, effacée automatiquement après 3 ans.</p>
        {sante === null ? (
          cliente.sante_consentement_le ? (
            <button
              className="puce mt-2 !py-1.5"
              onClick={async () => {
                const r = await lireSante({ data: { salonId: salon.id, clienteId: cliente.id } });
                setSante(r.texte);
              }}
            >
              Afficher
            </button>
          ) : (
            <button className="puce mt-2 !py-1.5" onClick={() => setSante("")}>Ajouter</button>
          )
        ) : (
          <div className="mt-2 space-y-2">
            <textarea value={sante} maxLength={1000} rows={2} onChange={(e) => setSante(e.target.value)} className="w-full rounded-xl border bg-white px-3 py-2" />
            <label className="flex items-start gap-2 text-xs">
              <input type="checkbox" checked={consentement} onChange={(e) => setConsentement(e.target.checked)} className="mt-0.5 size-4" />
              La cliente m'a donné son accord explicite pour conserver cette information.
            </label>
            <button
              className="puce !py-1.5"
              disabled={!consentement}
              onClick={async () => {
                try {
                  await enregistrerSante({ data: { salonId: salon.id, clienteId: cliente.id, texte: sante, consentement: true } });
                  toast.success("Information enregistrée et chiffrée.");
                  onChange();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Enregistrement impossible.");
                }
              }}
            >
              Enregistrer
            </button>
          </div>
        )}
      </div>

      <div>
        <p className="mb-1 font-medium">Historique</p>
        {((historique.data ?? []) as { id: string; statut: Statut; prestation_nom: string; date_debut: string; prix_total: number }[]).map((h) => (
          <p key={h.id} className="text-gris">
            <span className="capitalize">{parisLongDate(h.date_debut)}</span> · {h.prestation_nom} · {euros(h.prix_total)} · {LIBELLES_STATUT[h.statut]}
          </p>
        ))}
      </div>

      {role === "proprietaire" && (
        <button
          className="text-destructive underline"
          onClick={async () => {
            if (!window.confirm(`Supprimer définitivement ${cliente.prenom} ${cliente.nom} et tout son historique ?`)) return;
            try {
              await supprimerCliente({ data: { salonId: salon.id, clienteId: cliente.id } });
              toast.success("Fiche supprimée.");
              onChange();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Suppression impossible.");
            }
          }}
        >
          Supprimer la fiche (droit à l'effacement)
        </button>
      )}
    </div>
  );
}
