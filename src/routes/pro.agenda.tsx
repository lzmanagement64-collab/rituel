import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { chargerAgenda } from "@/lib/pro.functions";
import { useEspace } from "@/components/pro/espace";
import { CarteRdv, type Rdv } from "@/components/pro/CarteRdv";
import { parisDateISO, parisLongDate } from "@/lib/tz";

export const Route = createFileRoute("/pro/agenda")({ component: Agenda });

const JOUR = 86_400_000;

function Agenda() {
  const { salon } = useEspace();
  const [decalage, setDecalage] = useState(0); // en semaines
  const debut = parisDateISO(new Date(Date.now() + decalage * 7 * JOUR));
  const fin = parisDateISO(new Date(Date.now() + (decalage * 7 + 13) * JOUR));
  const q = useQuery({
    queryKey: ["agenda", salon.id, debut, fin],
    queryFn: () => chargerAgenda({ data: { salonId: salon.id, debut, fin } }),
  });
  const rdvs = (q.data ?? []) as Rdv[];
  const parJour = new Map<string, Rdv[]>();
  for (const r of rdvs) {
    const j = parisDateISO(r.date_debut);
    parJour.set(j, [...(parJour.get(j) ?? []), r]);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl">Agenda</h1>
        <div className="flex gap-2">
          <button className="puce" onClick={() => setDecalage((d) => d - 2)}>← Avant</button>
          {decalage !== 0 && <button className="puce" onClick={() => setDecalage(0)}>Aujourd'hui</button>}
          <button className="puce" onClick={() => setDecalage((d) => d + 2)}>Après →</button>
        </div>
      </div>
      {q.isLoading && <p className="text-gris">Chargement…</p>}
      {!q.isLoading && rdvs.length === 0 && <p className="text-gris">Aucun rendez-vous sur ces deux semaines.</p>}
      {[...parJour.entries()].map(([jour, liste]) => (
        <section key={jour}>
          <h2 className="mb-2 text-lg capitalize">{parisLongDate(`${jour}T12:00:00Z`)}</h2>
          <div className="space-y-2">
            {liste.map((r) => (
              <CarteRdv key={r.id} rdv={r} salonId={salon.id} avecDate={false} onChange={() => q.refetch()} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
