// ============================================================
// Espace pro : vérifie la session ET la double authentification avant
// d'afficher quoi que ce soit (la base l'exige aussi, de son côté).
// ============================================================
import { Link, Outlet, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type CSSProperties } from "react";
import { supabase } from "@/integrations/supabase/client";
import { monEspace } from "@/lib/pro.functions";
import { EspaceContext, type SalonPro } from "@/components/pro/espace";

export const Route = createFileRoute("/pro")({
  head: () => ({ meta: [{ title: "Rituel Pro" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: LayoutPro,
});

const LIENS = [
  { to: "/pro", libelle: "Accueil" },
  { to: "/pro/agenda", libelle: "Agenda" },
  { to: "/pro/clientes", libelle: "Clientes" },
  { to: "/pro/prestations", libelle: "Prestations" },
  { to: "/pro/horaires", libelle: "Horaires" },
  { to: "/pro/reglages", libelle: "Réglages" },
] as const;

function LayoutPro() {
  const navigate = useNavigate();
  const [pret, setPret] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: s } = await supabase.auth.getSession();
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (!s.session || aal?.currentLevel !== "aal2") {
        navigate({ to: "/connexion", replace: true });
        return;
      }
      setPret(true);
    })();
    const { data: ecoute } = supabase.auth.onAuthStateChange((evt) => {
      if (evt === "SIGNED_OUT") navigate({ to: "/connexion", replace: true });
    });
    return () => ecoute.subscription.unsubscribe();
  }, [navigate]);

  const espace = useQuery({ queryKey: ["espace"], queryFn: () => monEspace(), enabled: pret });

  if (!pret || espace.isLoading) return <p className="p-8 text-gris">Chargement…</p>;
  if (espace.error) return <p className="p-8 text-destructive">Impossible de charger votre espace. Rechargez la page.</p>;
  if (!espace.data?.salon) {
    return (
      <main className="mx-auto max-w-md p-8">
        <h1 className="text-2xl">Aucun salon rattaché</h1>
        <p className="mt-2 text-gris">Ce compte n'est rattaché à aucun salon. Contactez Rituel.</p>
        <button className="mt-4 underline" onClick={() => supabase.auth.signOut()}>Se déconnecter</button>
      </main>
    );
  }
  const salon = espace.data.salon as unknown as SalonPro;

  return (
    <EspaceContext.Provider value={{ salon, role: espace.data.role ?? "collaboratrice", recharger: () => espace.refetch() }}>
      <div className="min-h-screen" style={{ "--marque": salon.couleur } as CSSProperties}>
        <header className="sticky top-0 z-10 border-b bg-white/90 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3">
            <span className="font-display text-lg">{salon.nom}</span>
            <nav className="-mx-1 flex flex-1 gap-1 overflow-x-auto text-sm" aria-label="Espace pro">
              {LIENS.map((l) => (
                <Link
                  key={l.to}
                  to={l.to}
                  activeOptions={{ exact: l.to === "/pro" }}
                  className="whitespace-nowrap rounded-full px-3 py-1.5 text-gris hover:text-encre data-[status=active]:bg-lin data-[status=active]:text-encre"
                >
                  {l.libelle}
                </Link>
              ))}
            </nav>
            <button className="text-sm text-gris hover:text-encre" onClick={() => supabase.auth.signOut()}>
              Déconnexion
            </button>
          </div>
        </header>
        <BandeauEtat salon={salon} />
        <main className="mx-auto max-w-5xl px-4 py-8">
          <Outlet />
        </main>
      </div>
    </EspaceContext.Provider>
  );
}

function BandeauEtat({ salon }: { salon: SalonPro }) {
  const jours = Math.ceil((new Date(salon.essai_fin_le).getTime() - Date.now()) / 86_400_000);
  if (!salon.paiements_actifs) {
    return (
      <div className="bg-alerte/10 px-4 py-2 text-center text-sm">
        Les clientes ne peuvent pas encore réserver : activez le paiement des acomptes dans{" "}
        <Link to="/pro/reglages" className="font-semibold underline">Réglages</Link>.
      </div>
    );
  }
  if (salon.abonnement_statut === "essai" && jours <= 7) {
    return (
      <div className="bg-lin px-4 py-2 text-center text-sm">
        {jours > 0 ? `Essai gratuit : encore ${jours} jour${jours > 1 ? "s" : ""}.` : "Votre essai est terminé : la réservation en ligne est en pause."}
      </div>
    );
  }
  return null;
}
