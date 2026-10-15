# Rituel

Le carnet de rendez-vous des indépendantes de la beauté : réservation en ligne avec acompte obligatoire,
zéro commission, page aux couleurs du salon, données protégées.

**Cliente zéro : Emerald Beauty.**

---

## Ce qui est déjà construit (version 1)

**Côté clientes**
- Page de réservation par salon (`/r/<adresse-du-salon>`), aux couleurs du salon, à mettre en bio Instagram
- Choix de la prestation, du jour, de l'heure (calculés en direct : horaires, pauses, congés, rendez-vous pris)
- Paiement de l'acompte par carte, Apple Pay ou Google Pay, versé **directement sur le compte Stripe du salon**
- Créneau bloqué 30 minutes le temps du paiement, puis libéré automatiquement
- Page « mon rendez-vous » (lien personnel par e-mail) : voir, annuler, être remboursée selon les règles du salon
- E-mails : demande reçue, confirmée, refusée, annulée (avec avertissement anti-arnaque)

**Côté salon (espace pro)**
- Connexion sans mot de passe (code par e-mail) + **double authentification obligatoire**
- Accueil : demandes à valider, rendez-vous du jour, chiffre d'affaires, acomptes gardés sur les lapins
- Valider / refuser (remboursement automatique), marquer venue / absente
- Agenda, prestations, horaires et congés, réglages et règles d'acompte et d'annulation
- Fiches clientes : notes privées, allergies **chiffrées avec consentement**, historique, export CSV, suppression
- Activation des paiements Stripe en quelques clics

**Sécurité (vérifiée par des tests automatiques)**
- Chaque salon est isolé des autres **par la base de données elle-même**
- Sans double authentification, la base ne montre aucune donnée
- Les visiteuses ne lisent aucune table ; l'adresse du salon reste privée jusqu'à la confirmation
- Les montants et l'argent ne se modifient que côté serveur ; double réservation impossible, même simultanée
- Webhooks Stripe signés et rejouables sans effet ; journal de toutes les modifications, impossible à effacer
- Purge automatique des fiches inactives (3 ans) et des données de santé
- Aucune donnée réelle dans les tests

---

## Mise en route, étape par étape

> Fais les étapes dans l'ordre. À chaque étape marquée 🤝, reviens dans la conversation avec Claude.

### 1. GitHub — créer le dépôt (2 min) 🤝
1. Va sur github.com, connecté au compte **lzmanagement64-collab**.
2. Bouton **New** (nouveau dépôt). Nom : `rituel`. Choisis **Private**. Ne coche rien d'autre.
3. **Create repository**. Dis à Claude : « le dépôt rituel est créé ». Il y envoie le code.
4. Onglet **Actions** du dépôt : la vérification automatique doit afficher une coche verte.
   Une croix rouge = Claude corrige avant toute mise en ligne.

### 2. Supabase — la base de données (10 min) 🤝
1. supabase.com → **New project**. Nom : `rituel`. Région : **Europe (Paris ou Frankfurt)**.
   Mot de passe de la base : génère-le et garde-le dans ton gestionnaire de mots de passe.
2. **SQL Editor** → **New query** → colle tout le fichier `supabase/migrations/20261015090000_rituel_schema.sql` → **Run**.
3. **Authentication → Sign In / Providers → Email** : décoche **Allow new users to sign up** (personne ne crée de compte sans toi).
4. **Authentication → Emails → Magic Link** : remplace le contenu par
   `Votre code de connexion Rituel : {{ .Token }}` (il expire en quelques minutes).
5. **Authentication → Multi-Factor** : vérifie que **TOTP** est activé.
6. **Project Settings → API** : note l'URL, la clé *publishable* et la clé *secret* (cette dernière ne se partage jamais).

### 3. Stripe — les paiements (15 min) 🤝
1. Connecte-toi au Stripe de **LZ Management** (pas celui de Maria). Reste en **mode test** pour commencer.
2. **Connect** → active Connect, type de plateforme « marketplace / plateforme SaaS », comptes **Standard**.
3. **Développeurs → Clés API** : note la clé publiable (`pk_test_…`) et la clé secrète (`sk_test_…`).
4. Le webhook se crée à l'étape 6, une fois l'adresse du site connue.

### 4. Resend — les e-mails (10 min)
1. resend.com → ajoute ton domaine et suis les instructions DNS (chez Hostinger).
2. Crée une clé API. Expéditeur conseillé : `Rituel <rdv@ton-domaine.fr>`.

### 5. Les secrets
Copie `.env.example` : il liste toutes les variables. Deux sont à générer une fois et à garder en lieu sûr :
- `SANTE_CLE` (chiffrement des allergies) — **la perdre = perdre ces données**
- `CRON_SECRET` (au moins 24 caractères aléatoires)

Claude peut te les générer.

### 6. Hébergement et mise en ligne 🤝
À décider avec Claude (Vercel ou Cloudflare), en fonction du premier essai de compilation.
Ensuite : saisir les variables, mettre en ligne, puis créer le webhook Stripe
(**Développeurs → Webhooks → Ajouter → « Événements sur les comptes connectés »**,
adresse `https://<site>/api/public/stripe`, événements `payment_intent.succeeded`, `charge.refunded`, `account.updated`).

### 7. Créer le salon de Maria 🤝
1. Supabase → **Authentication → Users → Invite user** : l'e-mail de Maria.
2. **SQL Editor** : colle `scripts/creer-salon.sql`, remplace les valeurs entre `<< >>`, **Run**.
3. Maria se connecte sur `/connexion`, active sa double authentification, ajoute ses prestations,
   puis **Réglages → Activer les paiements** (son propre compte Stripe).

### 8. Tâche planifiée
Sur cron-job.org (gratuit) : toutes les 10 minutes, `POST https://<site>/api/public/taches`
avec l'en-tête `Authorization: Bearer <CRON_SECRET>`.

### 9. Test complet en mode test
Réserve chez Maria avec la carte de test `4242 4242 4242 4242`, valide, annule, vérifie les e-mails
et les remboursements. Ensuite seulement : clés Stripe réelles.

---

## Pas encore construit (prochaines versions)

- Facturation des abonnements des salons (Stripe Billing) — en attendant, facture à la main pendant l'essai
- Rappels automatiques à J-2 (e-mail puis SMS), relance fidélité, demande d'avis Google
- Assistante IA dans les DM Instagram / WhatsApp
- Inscription des salons en libre-service ; plusieurs salons par compte
- Protection anti-robots (Cloudflare Turnstile) sur la réservation, en plus des limites déjà en base
- Politique de sécurité du contenu (CSP) des pages ; test d'intrusion externe avant le 2e salon payant
- Génération des types Supabase (`supabase gen types`) une fois le projet créé

## Pour les développeurs

Voir [CLAUDE.md](./CLAUDE.md). Vérifications : `bun test tests`, `bash scripts/tester-base.sh`, `bun run build`.
