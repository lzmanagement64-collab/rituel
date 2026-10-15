import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { actualiserStripe, connecterStripe, enregistrerReglages } from "@/lib/pro.functions";
import { useEspace, type SalonPro } from "@/components/pro/espace";

export const Route = createFileRoute("/pro/reglages")({ component: Reglages });

type Champs = Pick<
  SalonPro,
  | "nom"
  | "metier"
  | "ville"
  | "adresse"
  | "telephone"
  | "email_contact"
  | "instagram"
  | "description"
  | "couleur"
  | "acompte_pourcent"
  | "annulation_gratuite_heures"
  | "delai_min_heures"
  | "horizon_jours"
>;

function Reglages() {
  const { salon, role, recharger } = useEspace();
  const proprietaire = role === "proprietaire";
  const [v, setV] = useState<Champs>(() => ({
    nom: salon.nom,
    metier: salon.metier,
    ville: salon.ville,
    adresse: salon.adresse,
    telephone: salon.telephone,
    email_contact: salon.email_contact,
    instagram: salon.instagram,
    description: salon.description,
    couleur: salon.couleur,
    acompte_pourcent: salon.acompte_pourcent,
    annulation_gratuite_heures: salon.annulation_gratuite_heures,
    delai_min_heures: salon.delai_min_heures,
    horizon_jours: salon.horizon_jours,
  }));
  const [stripeEnCours, setStripeEnCours] = useState(false);
  const maj = (c: Partial<Champs>) => setV((x) => ({ ...x, ...c }));

  // Retour depuis la page Stripe : on relit l'état du compte.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).has("stripe")) {
      actualiserStripe({ data: { salonId: salon.id } })
        .then((r: { actifs: boolean }) => {
          toast[r.actifs ? "success" : "message"](r.actifs ? "Paiements activés : vos clientes peuvent réserver." : "Stripe vérifie encore votre compte.");
          recharger();
        })
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function enregistrer(e: { preventDefault: () => void }) {
    e.preventDefault();
    try {
      await enregistrerReglages({ data: { salonId: salon.id, ...v } });
      toast.success("Réglages enregistrés.");
      recharger();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Enregistrement impossible.");
    }
  }

  async function ouvrirStripe() {
    setStripeEnCours(true);
    try {
      const { url } = await connecterStripe({ data: { salonId: salon.id } });
      window.location.href = url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Stripe indisponible.");
      setStripeEnCours(false);
    }
  }

  return (
    <div className="space-y-10">
      <section className="carte space-y-3 p-5">
        <h2 className="text-xl">Paiement des acomptes</h2>
        {salon.paiements_actifs ? (
          <p className="text-sm">Actif. Les acomptes arrivent directement sur votre compte Stripe, sans commission Rituel.</p>
        ) : (
          <p className="text-sm text-gris">
            Ouvrez votre compte Stripe (5 minutes, pièce d'identité et IBAN). Rituel ne voit jamais vos coordonnées bancaires.
          </p>
        )}
        {proprietaire && (
          <button className="btn-marque !py-2 text-sm" disabled={stripeEnCours} onClick={ouvrirStripe}>
            {salon.stripe_account_id ? (salon.paiements_actifs ? "Gérer mon compte Stripe" : "Terminer l'inscription Stripe") : "Activer les paiements"}
          </button>
        )}
      </section>

      <form onSubmit={enregistrer} className="space-y-6">
        <fieldset disabled={!proprietaire} className="carte grid gap-4 p-5 sm:grid-cols-2">
          <legend className="px-1 text-xl">Votre salon</legend>
          <Champ libelle="Nom du salon" valeur={v.nom} onChange={(x) => maj({ nom: x })} max={80} requis />
          <Champ libelle="Métier" valeur={v.metier} onChange={(x) => maj({ metier: x })} max={60} />
          <Champ libelle="Ville" valeur={v.ville} onChange={(x) => maj({ ville: x })} max={80} />
          <Champ libelle="Adresse (envoyée après confirmation)" valeur={v.adresse} onChange={(x) => maj({ adresse: x })} max={200} />
          <Champ libelle="Téléphone" valeur={v.telephone} onChange={(x) => maj({ telephone: x })} max={30} />
          <Champ libelle="E-mail de contact" type="email" valeur={v.email_contact} onChange={(x) => maj({ email_contact: x })} max={160} requis />
          <Champ libelle="Instagram (@compte)" valeur={v.instagram} onChange={(x) => maj({ instagram: x })} max={60} />
          <label className="text-sm">
            <span className="mb-1 block font-medium">Couleur de votre page</span>
            <input type="color" value={v.couleur} onChange={(e) => maj({ couleur: e.target.value })} className="h-10 w-20 rounded-lg border bg-white" />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block font-medium">Présentation (affichée sur votre page)</span>
            <textarea value={v.description} maxLength={600} rows={3} onChange={(e) => maj({ description: e.target.value })} className="w-full rounded-xl border bg-white px-3 py-2" />
          </label>
        </fieldset>

        <fieldset disabled={!proprietaire} className="carte grid gap-4 p-5 sm:grid-cols-2">
          <legend className="px-1 text-xl">Règles de réservation</legend>
          <Nombre libelle="Acompte (% du prix)" valeur={v.acompte_pourcent} min={10} max={100} onChange={(x) => maj({ acompte_pourcent: x })} />
          <Nombre libelle="Annulation gratuite jusqu'à (heures avant)" valeur={v.annulation_gratuite_heures} min={0} max={336} onChange={(x) => maj({ annulation_gratuite_heures: x })} />
          <Nombre libelle="Délai minimum avant un rendez-vous (heures)" valeur={v.delai_min_heures} min={0} max={168} onChange={(x) => maj({ delai_min_heures: x })} />
          <Nombre libelle="Réservable jusqu'à (jours à l'avance)" valeur={v.horizon_jours} min={7} max={365} onChange={(x) => maj({ horizon_jours: x })} />
        </fieldset>

        {proprietaire ? <button className="btn-marque">Enregistrer</button> : <p className="text-sm text-gris">Seule la propriétaire du salon peut modifier ces réglages.</p>}
      </form>
    </div>
  );
}

function Champ({ libelle, valeur, onChange, max, requis, type = "text" }: { libelle: string; valeur: string; onChange: (v: string) => void; max: number; requis?: boolean; type?: string }) {
  return (
    <label className="text-sm">
      <span className="mb-1 block font-medium">{libelle}</span>
      <input type={type} value={valeur} maxLength={max} required={requis} onChange={(e) => onChange(e.target.value)} className="w-full rounded-xl border bg-white px-3 py-2" />
    </label>
  );
}

function Nombre({ libelle, valeur, onChange, min, max }: { libelle: string; valeur: number; onChange: (v: number) => void; min: number; max: number }) {
  return (
    <label className="text-sm">
      <span className="mb-1 block font-medium">{libelle}</span>
      <input type="number" value={valeur} min={min} max={max} required onChange={(e) => onChange(Number(e.target.value))} className="w-full rounded-xl border bg-white px-3 py-2" />
    </label>
  );
}
