// Validation de tout ce qui arrive du navigateur (rien n'est cru sur parole).
import { z } from "zod";

const uuid = z.string().uuid();
const slug = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const heure = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const texte = (max: number) => z.string().trim().max(max);

export const slugSchema = z.object({ slug });
export const tokenSchema = z.object({ token: uuid });
export const salonIdSchema = z.object({ salonId: uuid });
export const idSchema = z.object({ salonId: uuid, id: uuid });

export const creneauxSchema = z.object({ slug, prestationId: uuid, date });

export const reservationSchema = z.object({
  slug,
  prestationId: uuid,
  date,
  heure,
  prenom: texte(60).min(1, "Prénom requis"),
  nom: texte(60).min(1, "Nom requis"),
  email: z.string().trim().toLowerCase().email("E-mail invalide").max(160),
  telephone: z
    .string()
    .trim()
    .regex(/^[+0-9 ().-]{6,30}$/, "Téléphone invalide"),
  commentaire: texte(500).default(""),
  conditions: z.literal(true, { errorMap: () => ({ message: "Merci d'accepter les conditions." }) }),
  // Champ piège invisible : un humain le laisse vide, un robot le remplit.
  site: z.string().max(0).optional().default(""),
});
export type ReservationInput = z.infer<typeof reservationSchema>;

export const statutSchema = z.object({
  salonId: uuid,
  reservationId: uuid,
  statut: z.enum(["confirmee", "refusee", "annulee", "honoree", "absente"]),
});

export const periodeSchema = z.object({ salonId: uuid, debut: date, fin: date });

export const prestationSchema = z.object({
  salonId: uuid,
  id: uuid.optional(),
  nom: texte(80).min(2),
  description: texte(300).default(""),
  duree_minutes: z.coerce.number().int().min(5).max(600),
  prix: z.coerce.number().min(0).max(5000),
  acompte_fixe: z.coerce.number().min(1).max(5000).nullable().default(null),
  actif: z.boolean().default(true),
  ordre: z.coerce.number().int().min(0).max(999).default(0),
});

const jourSchema = z
  .object({
    jour_semaine: z.number().int().min(0).max(6),
    ferme: z.boolean(),
    heure_debut: heure,
    heure_fin: heure,
    pause_debut: heure.nullable(),
    pause_fin: heure.nullable(),
  })
  .refine((j) => j.ferme || j.heure_fin > j.heure_debut, "L'heure de fin doit suivre l'heure de début.")
  .refine((j) => (j.pause_debut === null) === (j.pause_fin === null), "Pause incomplète.");

export const horairesSchema = z.object({ salonId: uuid, jours: z.array(jourSchema).length(7) });

export const indispoSchema = z.object({
  salonId: uuid,
  debut: date,
  fin: date,
  motif: texte(120).default(""),
});

export const reglagesSchema = z.object({
  salonId: uuid,
  nom: texte(80).min(2),
  metier: texte(60),
  ville: texte(80),
  adresse: texte(200),
  telephone: texte(30),
  email_contact: z.string().trim().email().max(160),
  instagram: texte(60),
  description: texte(600),
  couleur: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  acompte_pourcent: z.coerce.number().int().min(10).max(100),
  annulation_gratuite_heures: z.coerce.number().int().min(0).max(336),
  delai_min_heures: z.coerce.number().int().min(0).max(168),
  horizon_jours: z.coerce.number().int().min(7).max(365),
});

export const notesSchema = z.object({
  salonId: uuid,
  clienteId: uuid,
  notes_privees: texte(2000),
});

export const santeSchema = z.object({
  salonId: uuid,
  clienteId: uuid,
  texte: texte(1000),
  // Consentement explicite de la cliente, recueilli par la professionnelle
  consentement: z.literal(true, { errorMap: () => ({ message: "Le consentement de la cliente est obligatoire." }) }),
});

export const clienteSchema = z.object({ salonId: uuid, clienteId: uuid });
