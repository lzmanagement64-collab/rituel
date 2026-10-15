-- ============================================================
-- Créer un salon et rattacher sa propriétaire.
-- À coller dans Supabase → SQL Editor, APRÈS avoir invité la
-- propriétaire (Authentication → Users → Invite user).
-- Remplacer les valeurs entre << >>.
-- ============================================================
WITH s AS (
  INSERT INTO public.salons (slug, nom, metier, ville, telephone, email_contact, couleur)
  VALUES ('<<adresse-du-salon>>', '<<Nom du salon>>', 'Prothésiste ongulaire', '<<Ville>>', '<<téléphone>>',
          '<<email@du-salon.fr>>', '#1f6b43')
  RETURNING id
), m AS (
  INSERT INTO public.membres (salon_id, user_id, role)
  SELECT s.id, u.id, 'proprietaire' FROM s, auth.users u WHERE lower(u.email) = lower('<<email@du-salon.fr>>')
  RETURNING salon_id
)
-- Horaires de départ : du mardi au samedi, 9 h – 18 h (modifiables ensuite dans l'espace pro)
INSERT INTO public.horaires (salon_id, jour_semaine, ferme, heure_debut, heure_fin, pause_debut, pause_fin)
SELECT m.salon_id, j, j IN (0, 1), '09:00', '18:00', '12:30', '13:30' FROM m, generate_series(0, 6) j;

-- Vérification : doit afficher le salon et sa propriétaire
SELECT s.slug, s.nom, u.email, m.role
FROM public.salons s JOIN public.membres m ON m.salon_id = s.id JOIN auth.users u ON u.id = m.user_id
WHERE s.slug = '<<adresse-du-salon>>';
