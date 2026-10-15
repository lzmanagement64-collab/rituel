// ============================================================
// Règles métier partagées (navigateur + serveur), sans dépendance.
// Les montants qui comptent sont TOUJOURS recalculés par la base ;
// ces fonctions servent à l'affichage et aux contrôles côté serveur.
// ============================================================

/** Acompte d'une prestation : montant fixe s'il existe, sinon pourcentage du salon (min 1 €). */
export function calculerAcompte(prix: number, pourcent: number, fixe?: number | null): number {
  if (fixe != null && fixe > 0) return Math.min(arrondi(fixe), arrondi(prix));
  const a = arrondi((prix * pourcent) / 100);
  return a < 1 ? Math.min(arrondi(prix), 1) : a;
}

export const arrondi = (n: number) => Math.round(n * 100) / 100;

export function euros(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
  }).format(v);
}

export function duree(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

/** Adresse de salon valide : minuscules, chiffres, tirets, 3 à 40 caractères. */
export function slugValide(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(slug);
}

/** Transforme un nom en adresse de salon (« Emerald Beauty » → « emerald-beauty »). */
export function versSlug(nom: string): string {
  return nom
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

// ------------------------------------------------------------
// Statuts lisibles
// ------------------------------------------------------------
export type Statut =
  | "en_attente_paiement"
  | "a_valider"
  | "confirmee"
  | "refusee"
  | "annulee"
  | "honoree"
  | "absente";

export const LIBELLES_STATUT: Record<Statut, string> = {
  en_attente_paiement: "Paiement en cours",
  a_valider: "À valider",
  confirmee: "Confirmé",
  refusee: "Refusé",
  annulee: "Annulé",
  honoree: "Venue",
  absente: "Absente",
};

/** Actions possibles pour le salon depuis un statut (même règle que la base). */
export const ACTIONS_SALON: Record<Statut, { statut: Statut; libelle: string }[]> = {
  en_attente_paiement: [],
  a_valider: [
    { statut: "confirmee", libelle: "Valider" },
    { statut: "refusee", libelle: "Refuser et rembourser" },
  ],
  confirmee: [
    { statut: "honoree", libelle: "Venue" },
    { statut: "absente", libelle: "Absente" },
    { statut: "annulee", libelle: "Annuler et rembourser" },
  ],
  refusee: [],
  annulee: [],
  honoree: [{ statut: "absente", libelle: "Marquer absente" }],
  absente: [{ statut: "honoree", libelle: "Marquer venue" }],
};

/** Le salon rembourse-t-il l'acompte lors de ce changement ? */
export function salonRembourse(nouveau: Statut): boolean {
  return nouveau === "refusee" || nouveau === "annulee";
}

// ------------------------------------------------------------
// Erreurs de la base → messages pour les clientes et les pros
// ------------------------------------------------------------
const MESSAGES: Record<string, string> = {
  SALON_INCONNU: "Ce salon n'existe pas ou n'accepte plus de réservations en ligne.",
  SALON_FERME: "Ce salon ne prend pas de réservations en ligne pour le moment.",
  PAIEMENTS_INACTIFS: "Ce salon n'a pas encore activé le paiement en ligne.",
  PRESTATION_INCONNUE: "Cette prestation n'est plus proposée.",
  CRENEAU_INDISPONIBLE: "Ce créneau vient d'être réservé. Merci d'en choisir un autre.",
  MONTANT_INCOHERENT: "Le montant payé ne correspond pas à l'acompte.",
  ACCES_REFUSE: "Vous n'avez pas accès à ce rendez-vous.",
  TRANSITION_INTERDITE: "Ce changement n'est pas possible pour ce rendez-vous.",
  RESERVATION_INCONNUE: "Rendez-vous introuvable.",
  ANNULATION_IMPOSSIBLE: "Ce rendez-vous ne peut plus être annulé en ligne.",
  TROP_DE_DEMANDES: "Vous avez déjà une réservation en cours de paiement. Terminez-la ou attendez 30 minutes.",
};

export function messageErreur(brut: unknown, defaut = "Une erreur est survenue. Merci de réessayer."): string {
  const texte = typeof brut === "string" ? brut : brut instanceof Error ? brut.message : "";
  for (const code of Object.keys(MESSAGES)) {
    if (texte.includes(code)) return MESSAGES[code];
  }
  return defaut;
}
