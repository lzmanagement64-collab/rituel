// Salon de la professionnelle connectée, partagé par toutes les pages pro.
import { createContext, useContext } from "react";

export type SalonPro = {
  id: string;
  slug: string;
  nom: string;
  metier: string;
  ville: string;
  adresse: string;
  telephone: string;
  email_contact: string;
  instagram: string;
  description: string;
  couleur: string;
  acompte_pourcent: number;
  annulation_gratuite_heures: number;
  delai_min_heures: number;
  horizon_jours: number;
  paiements_actifs: boolean;
  stripe_account_id: string | null;
  formule: string;
  abonnement_statut: string;
  essai_fin_le: string;
};

export const EspaceContext = createContext<{ salon: SalonPro; role: string; recharger: () => void } | null>(null);

export function useEspace() {
  const v = useContext(EspaceContext);
  if (!v) throw new Error("useEspace hors de l'espace pro");
  return v;
}
