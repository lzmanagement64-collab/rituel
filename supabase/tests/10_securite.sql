-- ============================================================
-- TESTS DE SÉCURITÉ — Rituel
-- Chaque test essaie de casser une règle. Le script s'arrête à la
-- première règle qui ne tient pas (message « ÉCHEC : … »).
-- Lancement : scripts/tester-base.sh
-- ============================================================
\set ON_ERROR_STOP on
\set QUIET on
SET client_min_messages = warning;
\o /dev/null

-- ------------------------------------------------------------
-- Jeu de données FICTIF (aucune donnée réelle, jamais)
-- ------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'proprio-a@exemple.test'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'proprio-b@exemple.test'),
  ('cccccccc-0000-0000-0000-000000000003', 'collab-a@exemple.test');

INSERT INTO public.salons (id, slug, nom, email_contact, paiements_actifs, stripe_account_id) VALUES
  ('a0000000-0000-0000-0000-00000000000a', 'salon-a', 'Salon A', 'a@exemple.test', true, 'acct_test_a'),
  ('b0000000-0000-0000-0000-00000000000b', 'salon-b', 'Salon B', 'b@exemple.test', true, 'acct_test_b');

INSERT INTO public.membres (salon_id, user_id, role) VALUES
  ('a0000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'proprietaire'),
  ('b0000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000002', 'proprietaire'),
  ('a0000000-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000003', 'collaboratrice');

INSERT INTO public.prestations (id, salon_id, nom, duree_minutes, prix) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'Pose gel', 90, 50),
  ('b1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b', 'Remplissage', 60, 40);

-- Ouvert tous les jours 9 h – 18 h, pause 12 h 30 – 13 h 30
INSERT INTO public.horaires (salon_id, jour_semaine, heure_debut, heure_fin, pause_debut, pause_fin)
SELECT s.id, j, '09:00', '18:00', '12:30', '13:30'
FROM public.salons s CROSS JOIN generate_series(0, 6) j;

-- Jour de test : dans 5 jours (heure locale de Paris)
CREATE TEMP TABLE t AS SELECT ((now() AT TIME ZONE 'Europe/Paris')::date + 5) AS jour;
GRANT SELECT ON t TO anon, authenticated, service_role;

-- Outils de test
CREATE OR REPLACE FUNCTION pg_temp.verifier(condition boolean, message text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'ÉCHEC : %', message; END IF;
END $$;

\echo '1. Visiteuse anonyme : aucune table lisible'
SET ROLE anon;
DO $$ BEGIN
  PERFORM 1 FROM public.reservations;
  RAISE EXCEPTION 'ÉCHEC : une visiteuse lit les réservations';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  PERFORM 1 FROM public.clientes;
  RAISE EXCEPTION 'ÉCHEC : une visiteuse lit les clientes';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  PERFORM 1 FROM public.salons;
  RAISE EXCEPTION 'ÉCHEC : une visiteuse lit la table des salons (dont le compte Stripe)';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

\echo '2. Visiteuse anonyme : infos publiques OK, création directe interdite'
SELECT pg_temp.verifier((SELECT count(*) FROM public.salon_public('salon-a')) = 1, 'salon public introuvable');
SELECT pg_temp.verifier((SELECT count(*) FROM public.prestations_publiques('salon-a')) = 1, 'prestations publiques');
SELECT pg_temp.verifier(
  (SELECT count(*) FROM public.creneaux_disponibles('salon-a', (SELECT jour FROM t), 'a1000000-0000-0000-0000-000000000001')) > 0,
  'aucun créneau public');
-- Une prestation du salon B demandée via la page du salon A : rien
SELECT pg_temp.verifier(
  (SELECT count(*) FROM public.creneaux_disponibles('salon-a', (SELECT jour FROM t), 'b1000000-0000-0000-0000-000000000001')) = 0,
  'créneaux calculés avec la prestation d''un autre salon');
DO $$ BEGIN
  PERFORM public.creer_demande('salon-a', 'a1000000-0000-0000-0000-000000000001', (SELECT jour FROM t), '10:00',
    'X', 'Y', 'x@exemple.test', '0600000000', '');
  RAISE EXCEPTION 'ÉCHEC : une visiteuse appelle creer_demande sans passer par le serveur';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
RESET ROLE;

-- ------------------------------------------------------------
-- Création de demandes (fait par le serveur, clé de service)
-- ------------------------------------------------------------
\echo '3. Double réservation impossible, même simultanée'
SET ROLE service_role;
CREATE TEMP TABLE d1 AS SELECT * FROM public.creer_demande('salon-a', 'a1000000-0000-0000-0000-000000000001',
  (SELECT jour FROM t), '10:00', 'Léa', 'Martin', 'LEA@exemple.test', '0601020304', 'Première fois');
SELECT pg_temp.verifier((SELECT acompte FROM d1) = 15.00, 'acompte de 30 % mal calculé');
DO $$ BEGIN
  PERFORM public.creer_demande('salon-a', 'a1000000-0000-0000-0000-000000000001', (SELECT jour FROM t), '10:00',
    'Zoé', 'Durand', 'zoe@exemple.test', '0605060708', '');
  RAISE EXCEPTION 'ÉCHEC : même créneau réservé deux fois';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%CRENEAU_INDISPONIBLE%' THEN RAISE; END IF;
END $$;
-- Chevauchement partiel (10 h 30 alors que 10 h – 11 h 30 est pris)
DO $$ BEGIN
  PERFORM public.creer_demande('salon-a', 'a1000000-0000-0000-0000-000000000001', (SELECT jour FROM t), '10:30',
    'Zoé', 'Durand', 'zoe@exemple.test', '0605060708', '');
  RAISE EXCEPTION 'ÉCHEC : chevauchement accepté';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%CRENEAU_INDISPONIBLE%' THEN RAISE; END IF;
END $$;
-- La base elle-même refuse le chevauchement, même en contournant la fonction
DO $$ BEGIN
  INSERT INTO public.reservations (salon_id, prestation_id, cliente_id, date_debut, date_fin, prestation_nom, prix_total)
  SELECT r.salon_id, r.prestation_id, r.cliente_id, r.date_debut + interval '15 minutes', r.date_fin, 'x', 10
  FROM public.reservations r LIMIT 1;
  RAISE EXCEPTION 'ÉCHEC : la contrainte anti-chevauchement ne tient pas';
EXCEPTION WHEN exclusion_violation THEN NULL; END $$;
-- Le même créneau reste libre dans un AUTRE salon
SELECT pg_temp.verifier(
  (SELECT count(*) FROM public.creneaux_disponibles('salon-b', (SELECT jour FROM t), 'b1000000-0000-0000-0000-000000000001') c
   WHERE c.heure = '10:00') = 1, 'le créneau d''un salon bloque un autre salon');
-- Pause déjeuner respectée
SELECT pg_temp.verifier(
  (SELECT count(*) FROM public.creneaux_disponibles('salon-a', (SELECT jour FROM t), 'a1000000-0000-0000-0000-000000000001') c
   WHERE c.heure = '12:00') = 0, 'créneau proposé pendant la pause');

\echo '4. Référence vers la donnée d''un autre salon impossible'
DO $$ BEGIN
  INSERT INTO public.reservations (salon_id, prestation_id, cliente_id, date_debut, date_fin, prestation_nom, prix_total)
  SELECT 'a0000000-0000-0000-0000-00000000000a', 'b1000000-0000-0000-0000-000000000001', c.id,
         now() + interval '20 days', now() + interval '20 days 1 hour', 'x', 10
  FROM public.clientes c WHERE c.salon_id = 'a0000000-0000-0000-0000-00000000000a' LIMIT 1;
  RAISE EXCEPTION 'ÉCHEC : réservation du salon A sur une prestation du salon B';
EXCEPTION WHEN foreign_key_violation THEN NULL; END $$;

\echo '5. Paiement : montant vérifié, webhook rejoué sans effet'
UPDATE public.reservations SET stripe_payment_intent = 'pi_test_1' WHERE id = (SELECT reservation_id FROM d1);
DO $$ BEGIN
  PERFORM public.acompte_recu('pi_test_1', 100);
  RAISE EXCEPTION 'ÉCHEC : acompte accepté avec un mauvais montant';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%MONTANT_INCOHERENT%' THEN RAISE; END IF;
END $$;
SELECT pg_temp.verifier((SELECT nouveau FROM public.acompte_recu('pi_test_1', 1500)), 'premier paiement non signalé comme nouveau');
SELECT pg_temp.verifier(NOT (SELECT nouveau FROM public.acompte_recu('pi_test_1', 1500)), 'webhook rejoué traité deux fois (e-mails en double)');
SELECT pg_temp.verifier(
  (SELECT statut = 'a_valider' AND acompte_statut = 'paye' FROM public.reservations WHERE id = (SELECT reservation_id FROM d1)),
  'acompte payé mal enregistré');

\echo '5 bis. Remboursement rejoué : jamais compté deux fois'
CREATE TEMP TABLE dr AS SELECT * FROM public.creer_demande('salon-a', 'a1000000-0000-0000-0000-000000000001',
  (SELECT jour FROM t), '16:00', 'Rose', 'Blanc', 'rose@exemple.test', '0655555555', '');
UPDATE public.reservations SET stripe_payment_intent = 'pi_test_r' WHERE id = (SELECT reservation_id FROM dr);
SELECT public.acompte_recu('pi_test_r', 1500);
SELECT public.remboursement_enregistre('pi_test_r', 500);
SELECT public.remboursement_enregistre('pi_test_r', 500);
SELECT pg_temp.verifier((SELECT montant_rembourse FROM public.reservations WHERE id = (SELECT reservation_id FROM dr)) = 5, 'remboursement compté deux fois');
SELECT public.remboursement_enregistre('pi_test_r', 1500);
SELECT pg_temp.verifier((SELECT acompte_statut FROM public.reservations WHERE id = (SELECT reservation_id FROM dr)) = 'rembourse', 'remboursement total non marqué');

\echo '5 ter. Paiement arrivé après expiration : remboursement automatique demandé'
CREATE TEMP TABLE dx AS SELECT * FROM public.creer_demande('salon-a', 'a1000000-0000-0000-0000-000000000001',
  (SELECT jour FROM t) + 1, '10:00', 'Lou', 'Noir', 'lou@exemple.test', '0666666666', '');
UPDATE public.reservations SET stripe_payment_intent = 'pi_test_x', acompte_expire_le = now() - interval '1 minute' WHERE id = (SELECT reservation_id FROM dx);
SELECT public.liberer_expirees();
SELECT pg_temp.verifier((SELECT a_rembourser FROM public.acompte_recu('pi_test_x', 1500)), 'paiement tardif non remboursé');
SELECT pg_temp.verifier((SELECT statut FROM public.reservations WHERE id = (SELECT reservation_id FROM dx)) = 'annulee', 'paiement tardif a ressuscité un créneau');

\echo '6. Créneau non payé à temps : libéré automatiquement'
CREATE TEMP TABLE d2 AS SELECT * FROM public.creer_demande('salon-a', 'a1000000-0000-0000-0000-000000000001',
  (SELECT jour FROM t), '14:00', 'Inès', 'Petit', 'ines@exemple.test', '0611111111', '');
UPDATE public.reservations SET acompte_expire_le = now() - interval '1 minute' WHERE id = (SELECT reservation_id FROM d2);
SELECT pg_temp.verifier(
  (SELECT count(*) FROM public.creneaux_disponibles('salon-a', (SELECT jour FROM t), 'a1000000-0000-0000-0000-000000000001') c
   WHERE c.heure = '14:00') = 1, 'créneau expiré toujours bloqué');
CREATE TEMP TABLE d3 AS SELECT * FROM public.creer_demande('salon-a', 'a1000000-0000-0000-0000-000000000001',
  (SELECT jour FROM t), '14:00', 'Nora', 'Leroy', 'nora@exemple.test', '0622222222', '');
SELECT pg_temp.verifier(
  (SELECT statut = 'annulee' AND acompte_statut = 'expire' FROM public.reservations WHERE id = (SELECT reservation_id FROM d2)),
  'réservation expirée non annulée');
RESET ROLE;
GRANT SELECT ON d1, d2, d3 TO authenticated;

-- ------------------------------------------------------------
-- Professionnelles connectées
-- ------------------------------------------------------------
\echo '7. Sans double authentification : aucune donnée visible'
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","aal":"aal1"}', false);
SET ROLE authenticated;
SELECT pg_temp.verifier((SELECT count(*) FROM public.reservations) = 0, 'réservations visibles sans 2FA');
SELECT pg_temp.verifier((SELECT count(*) FROM public.clientes) = 0, 'clientes visibles sans 2FA');
SELECT pg_temp.verifier((SELECT count(*) FROM public.salons) = 0, 'salon visible sans 2FA');
RESET ROLE;

\echo '8. Propriétaire A (2FA) : voit son salon, jamais le salon B'
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","aal":"aal2"}', false);
SET ROLE authenticated;
SELECT pg_temp.verifier((SELECT count(*) FROM public.salons) = 1, 'nombre de salons visibles');
SELECT pg_temp.verifier((SELECT count(*) FROM public.reservations) = 5, 'réservations du salon A');
SELECT pg_temp.verifier((SELECT count(*) FROM public.reservations WHERE salon_id = 'b0000000-0000-0000-0000-00000000000b') = 0, 'réservations de B visibles');
SELECT pg_temp.verifier((SELECT count(*) FROM public.clientes WHERE salon_id = 'b0000000-0000-0000-0000-00000000000b') = 0, 'clientes de B visibles');
SELECT pg_temp.verifier((SELECT count(*) FROM public.prestations WHERE salon_id = 'b0000000-0000-0000-0000-00000000000b') = 0, 'prestations de B visibles');
SELECT pg_temp.verifier((SELECT count(*) FROM public.journal WHERE salon_id = 'b0000000-0000-0000-0000-00000000000b') = 0, 'journal de B visible');

\echo '9. Propriétaire A : aucune écriture possible dans le salon B'
DO $$ BEGIN
  INSERT INTO public.prestations (salon_id, nom, duree_minutes, prix)
  VALUES ('b0000000-0000-0000-0000-00000000000b', 'Piège', 30, 1);
  RAISE EXCEPTION 'ÉCHEC : A crée une prestation chez B';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
UPDATE public.salons SET nom = 'Piraté' WHERE id = 'b0000000-0000-0000-0000-00000000000b';
UPDATE public.prestations SET prix = 0 WHERE salon_id = 'b0000000-0000-0000-0000-00000000000b';
DELETE FROM public.horaires WHERE salon_id = 'b0000000-0000-0000-0000-00000000000b';
RESET ROLE;
SELECT pg_temp.verifier((SELECT nom FROM public.salons WHERE slug = 'salon-b') = 'Salon B', 'A a renommé le salon B');
SELECT pg_temp.verifier((SELECT prix FROM public.prestations WHERE salon_id = 'b0000000-0000-0000-0000-00000000000b') = 40, 'A a modifié un prix de B');
SELECT pg_temp.verifier((SELECT count(*) FROM public.horaires WHERE salon_id = 'b0000000-0000-0000-0000-00000000000b') = 7, 'A a supprimé des horaires de B');
SET ROLE authenticated;

\echo '10. Propriétaire A : argent et paiement intouchables depuis l''appli'
DO $$ BEGIN
  UPDATE public.salons SET stripe_account_id = 'acct_pirate' WHERE slug = 'salon-a';
  RAISE EXCEPTION 'ÉCHEC : compte Stripe modifiable depuis le navigateur';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  UPDATE public.salons SET abonnement_statut = 'actif' WHERE slug = 'salon-a';
  RAISE EXCEPTION 'ÉCHEC : abonnement modifiable depuis le navigateur';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  UPDATE public.reservations SET acompte_statut = 'rembourse';
  RAISE EXCEPTION 'ÉCHEC : statut d''acompte modifiable depuis le navigateur';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  UPDATE public.reservations SET statut = 'confirmee';
  RAISE EXCEPTION 'ÉCHEC : statut de réservation modifiable sans passer par le serveur';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  UPDATE public.clientes SET sante_chiffree = 'xxx';
  RAISE EXCEPTION 'ÉCHEC : données de santé écrites sans chiffrement serveur';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  INSERT INTO public.membres (salon_id, user_id) VALUES ('b0000000-0000-0000-0000-00000000000b', 'aaaaaaaa-0000-0000-0000-000000000001');
  RAISE EXCEPTION 'ÉCHEC : A s''ajoute elle-même dans l''équipe de B';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  DELETE FROM public.journal;
  RAISE EXCEPTION 'ÉCHEC : journal effaçable';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  PERFORM public.changer_statut((SELECT reservation_id FROM d1), 'confirmee', 'aaaaaaaa-0000-0000-0000-000000000001');
  RAISE EXCEPTION 'ÉCHEC : fonction serveur appelable depuis le navigateur';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
-- Ce qui est permis : présentation du salon et note interne
UPDATE public.salons SET description = 'Onglerie à Pau' WHERE slug = 'salon-a';
UPDATE public.reservations SET note_interne = 'Cliente fidèle' WHERE id = (SELECT reservation_id FROM d1);
SELECT pg_temp.verifier((SELECT note_interne FROM public.reservations WHERE id = (SELECT reservation_id FROM d1)) = 'Cliente fidèle', 'note interne non enregistrée');
RESET ROLE;

\echo '11. Collaboratrice : pas de réglages du salon ni de journal'
SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000003","aal":"aal2"}', false);
SET ROLE authenticated;
SELECT pg_temp.verifier((SELECT count(*) FROM public.reservations) = 5, 'la collaboratrice ne voit pas l''agenda');
SELECT pg_temp.verifier((SELECT count(*) FROM public.journal) = 0, 'journal visible par la collaboratrice');
UPDATE public.salons SET acompte_pourcent = 10 WHERE slug = 'salon-a';
RESET ROLE;
SELECT pg_temp.verifier((SELECT acompte_pourcent FROM public.salons WHERE slug = 'salon-a') = 30, 'la collaboratrice a changé l''acompte');

\echo '12. Changements de statut : seulement par l''équipe, seulement dans l''ordre'
SET ROLE service_role;
DO $$ BEGIN
  PERFORM public.changer_statut((SELECT reservation_id FROM d1), 'confirmee', 'bbbbbbbb-0000-0000-0000-000000000002');
  RAISE EXCEPTION 'ÉCHEC : B valide une réservation de A';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%ACCES_REFUSE%' THEN RAISE; END IF;
END $$;
DO $$ BEGIN
  PERFORM public.changer_statut((SELECT reservation_id FROM d1), 'honoree', 'aaaaaaaa-0000-0000-0000-000000000001');
  RAISE EXCEPTION 'ÉCHEC : « honorée » avant validation';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%TRANSITION_INTERDITE%' THEN RAISE; END IF;
END $$;
SELECT pg_temp.verifier((SELECT nouveau FROM public.changer_statut((SELECT reservation_id FROM d1), 'confirmee', 'aaaaaaaa-0000-0000-0000-000000000001')) = 'confirmee', 'validation impossible');

\echo '13. Annulation par la cliente : remboursement selon le délai'
-- Annulation tôt (dans 5 jours, délai de 48 h) : remboursée en entier
CREATE TEMP TABLE a1 AS SELECT * FROM public.annuler_par_cliente((SELECT token FROM d1));
SELECT pg_temp.verifier((SELECT a_rembourser FROM a1) = 15.00 AND NOT (SELECT tardive FROM a1), 'annulation à temps non remboursée');
DO $$ BEGIN
  PERFORM public.annuler_par_cliente((SELECT token FROM d1));
  RAISE EXCEPTION 'ÉCHEC : double annulation acceptée';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%ANNULATION_IMPOSSIBLE%' THEN RAISE; END IF;
END $$;
-- Annulation tardive (rendez-vous confirmé dans 24 h) : acompte conservé
UPDATE public.reservations SET statut = 'confirmee', acompte_statut = 'paye', stripe_payment_intent = 'pi_test_3',
  date_debut = now() + interval '24 hours', date_fin = now() + interval '25 hours 30 minutes'
WHERE id = (SELECT reservation_id FROM d3);
CREATE TEMP TABLE a2 AS SELECT * FROM public.annuler_par_cliente((SELECT token FROM d3));
SELECT pg_temp.verifier((SELECT a_rembourser FROM a2) = 0 AND (SELECT tardive FROM a2), 'annulation tardive remboursée');
SELECT pg_temp.verifier((SELECT acompte_statut FROM public.reservations WHERE id = (SELECT reservation_id FROM d3)) = 'conserve', 'acompte non marqué conservé');
-- Un jeton inventé ne donne rien
DO $$ BEGIN
  PERFORM public.annuler_par_cliente(gen_random_uuid());
  RAISE EXCEPTION 'ÉCHEC : jeton inventé accepté';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%ANNULATION_IMPOSSIBLE%' THEN RAISE; END IF;
END $$;

\echo '14. Salon dont l''essai est terminé : plus de réservations en ligne'
UPDATE public.salons SET essai_fin_le = now() - interval '1 day' WHERE slug = 'salon-b';
DO $$ BEGIN
  PERFORM public.creer_demande('salon-b', 'b1000000-0000-0000-0000-000000000001', (SELECT jour FROM t), '11:00',
    'Eva', 'Roux', 'eva@exemple.test', '0633333333', '');
  RAISE EXCEPTION 'ÉCHEC : réservation acceptée sur un salon fermé';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%SALON_FERME%' THEN RAISE; END IF;
END $$;
RESET ROLE;

\echo '15. Journal : tout est tracé, sans contenu sensible'
SELECT pg_temp.verifier((SELECT count(*) FROM public.journal WHERE cible = 'reservations') >= 6, 'journal incomplet');
SELECT pg_temp.verifier(
  (SELECT count(*) FROM public.journal WHERE details::text LIKE '%0601020304%' OR details::text LIKE '%LEA@%' OR details::text LIKE '%lea@%') = 0,
  'des coordonnées de cliente sont copiées dans le journal');
SELECT pg_temp.verifier(
  (SELECT user_id FROM public.journal WHERE cible = 'reservations' AND details ? 'note_interne' LIMIT 1) = 'aaaaaaaa-0000-0000-0000-000000000001',
  'auteur de la modification non tracé');

\echo '16. Purge RGPD : fiches inactives effacées'
INSERT INTO public.clientes (salon_id, prenom, nom, email, telephone, derniere_activite_le)
VALUES ('a0000000-0000-0000-0000-00000000000a', 'Ancienne', 'Cliente', 'ancienne@exemple.test', '0644444444', now() - interval '4 years');
SELECT public.purger_donnees();
SELECT pg_temp.verifier((SELECT count(*) FROM public.clientes WHERE email = 'ancienne@exemple.test') = 0, 'fiche inactive non purgée');
SELECT pg_temp.verifier((SELECT count(*) FROM public.clientes WHERE email = 'lea@exemple.test') = 1, 'fiche récente purgée à tort');

\echo ''
\echo 'TOUS LES TESTS DE SÉCURITÉ SONT PASSÉS.'
