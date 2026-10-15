# Rituel — consignes pour Claude Code

Rituel est une plateforme de réservation multi-salons pour les indépendantes de la beauté
(acompte obligatoire, zéro commission, page à la marque du salon). Propriétaire : Ken (LZ Management),
non technicien : expliquer simplement, en français, sans jargon.

## Règles de sécurité qui ne se négocient pas

1. **Toute table métier a un `salon_id` et des règles RLS** fondées sur `est_membre(salon_id)` /
   `est_proprietaire(salon_id)`. Ces fonctions exigent une session en double authentification (aal2).
2. **Les visiteuses ne lisent aucune table.** Elles passent par des fonctions `SECURITY DEFINER`
   (`salon_public`, `prestations_publiques`, `creneaux_disponibles`) qui ne renvoient que du public.
   L'adresse du salon n'est jamais publique (beaucoup reçoivent chez elles).
3. **L'argent ne se touche que côté serveur** (clé de service), après `exigerMembre()`.
   Montants recalculés en base, jamais repris du navigateur.
4. **Stripe Connect en paiements directs** : chaque appel Stripe lié à un salon passe `stripeAccount`.
   Rituel n'encaisse jamais pour autrui.
5. **Données de santé** : uniquement chiffrées par `src/lib/sante.ts` (clé `SANTE_CLE`), avec consentement.
6. **Jamais de données réelles** dans les tests ni dans un environnement de test.
7. Toute nouvelle migration va dans `supabase/migrations/` et ne modifie jamais une migration déjà appliquée.
8. Ne jamais commiter `.env` ni une clé.

## Avant chaque commit

```bash
bun test tests                 # logique (chiffrement, règles)
bash scripts/tester-base.sh    # sécurité de la base sur un PostgreSQL jetable
bun run build && bunx tsc --noEmit
```

Toute nouvelle règle d'accès ou fonction SQL = un test dans `supabase/tests/10_securite.sql`
qui essaie de la contourner. La même vérification tourne sur GitHub à chaque envoi.

## Repères

- `supabase/migrations/` : schéma, règles RLS, fonctions métier (réservation, paiement, annulation, purge RGPD)
- `src/lib/reservation.functions.ts` : fonctions serveur publiques (page de réservation)
- `src/lib/pro.functions.ts` : fonctions serveur de l'espace pro
- `src/lib/paiement.server.ts` : paiements et remboursements Stripe
- `src/routes/r.$slug.tsx` : page de réservation d'un salon · `rdv.$token.tsx` : page « mon rendez-vous »
- `src/routes/pro.*.tsx` : espace pro · `connexion.tsx` : code e-mail + double authentification
- `src/routes/api/public/stripe.ts` : webhook Stripe Connect · `taches.ts` : tâches planifiées
