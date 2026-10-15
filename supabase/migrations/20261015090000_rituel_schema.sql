-- ============================================================
-- RITUEL — schéma multi-salons
--
-- Principes de sécurité (vérifiés par la base elle-même, pas par l'appli) :
-- 1. Chaque ligne appartient à un salon (salon_id). Une professionnelle
--    ne voit QUE les lignes des salons dont elle est membre.
-- 2. Cet accès exige une session en double authentification (aal2).
--    Un mot de passe ou un lien volé seul ne suffit pas à lire les données.
-- 3. Les visiteuses (non connectées) ne lisent AUCUNE table : elles passent
--    par des fonctions qui ne renvoient que des informations publiques
--    (nom du salon, prestations, heures libres).
-- 4. L'argent (statut de l'acompte, remboursements, compte Stripe) ne se
--    modifie que côté serveur, avec la clé de service.
-- 5. Une référence d'un salon vers la donnée d'un autre salon est
--    impossible (clés étrangères composées id + salon_id).
-- 6. Toute modification sensible est inscrite dans un journal que
--    personne ne peut effacer depuis l'application.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ------------------------------------------------------------
-- Utilitaire : date de mise à jour
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- ============================================================
-- SALONS
-- ============================================================
CREATE TABLE public.salons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'),
  nom text NOT NULL CHECK (length(nom) BETWEEN 2 AND 80),
  metier text NOT NULL DEFAULT 'Prothésiste ongulaire' CHECK (length(metier) <= 60),
  ville text NOT NULL DEFAULT '' CHECK (length(ville) <= 80),
  adresse text NOT NULL DEFAULT '' CHECK (length(adresse) <= 200),
  telephone text NOT NULL DEFAULT '' CHECK (length(telephone) <= 30),
  email_contact text NOT NULL CHECK (email_contact ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  instagram text NOT NULL DEFAULT '' CHECK (length(instagram) <= 60),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 600),
  couleur text NOT NULL DEFAULT '#7a4b5c' CHECK (couleur ~ '^#[0-9a-fA-F]{6}$'),
  -- Règles de réservation
  acompte_pourcent int NOT NULL DEFAULT 30 CHECK (acompte_pourcent BETWEEN 10 AND 100),
  annulation_gratuite_heures int NOT NULL DEFAULT 48 CHECK (annulation_gratuite_heures BETWEEN 0 AND 336),
  delai_min_heures int NOT NULL DEFAULT 12 CHECK (delai_min_heures BETWEEN 0 AND 168),
  horizon_jours int NOT NULL DEFAULT 60 CHECK (horizon_jours BETWEEN 7 AND 365),
  pas_minutes int NOT NULL DEFAULT 15 CHECK (pas_minutes IN (5, 10, 15, 20, 30, 60)),
  fuseau text NOT NULL DEFAULT 'Europe/Paris',
  -- Paiement (modifiable par le serveur uniquement)
  stripe_account_id text UNIQUE,
  paiements_actifs boolean NOT NULL DEFAULT false,
  -- Abonnement Rituel (modifiable par le serveur uniquement)
  formule text NOT NULL DEFAULT 'essentiel' CHECK (formule IN ('essentiel', 'pro', 'premium')),
  abonnement_statut text NOT NULL DEFAULT 'essai'
    CHECK (abonnement_statut IN ('essai', 'actif', 'impaye', 'suspendu', 'resilie')),
  essai_fin_le timestamptz NOT NULL DEFAULT now() + interval '30 days',
  actif boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER salons_updated_at BEFORE UPDATE ON public.salons
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- MEMBRES (qui peut gérer quel salon)
-- ============================================================
CREATE TABLE public.membres (
  salon_id uuid NOT NULL REFERENCES public.salons(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'proprietaire' CHECK (role IN ('proprietaire', 'collaboratrice')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (salon_id, user_id)
);
CREATE INDEX membres_user_idx ON public.membres (user_id);

-- ------------------------------------------------------------
-- Contrôles d'accès (utilisés par toutes les règles RLS)
-- ------------------------------------------------------------
-- Session en double authentification ? (claim « aal » du jeton Supabase)
CREATE OR REPLACE FUNCTION public.session_securisee() RETURNS boolean
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

CREATE OR REPLACE FUNCTION public.est_membre(p_salon uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.session_securisee() AND EXISTS (
    SELECT 1 FROM public.membres m
    WHERE m.salon_id = p_salon AND m.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.est_proprietaire(p_salon uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.session_securisee() AND EXISTS (
    SELECT 1 FROM public.membres m
    WHERE m.salon_id = p_salon AND m.user_id = auth.uid() AND m.role = 'proprietaire'
  );
$$;

-- ============================================================
-- PRESTATIONS
-- ============================================================
CREATE TABLE public.prestations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id uuid NOT NULL REFERENCES public.salons(id) ON DELETE CASCADE,
  nom text NOT NULL CHECK (length(nom) BETWEEN 2 AND 80),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 300),
  duree_minutes int NOT NULL CHECK (duree_minutes BETWEEN 5 AND 600),
  prix numeric(10,2) NOT NULL CHECK (prix >= 0 AND prix <= 5000),
  -- Acompte fixe pour cette prestation (sinon : pourcentage du salon)
  acompte_fixe numeric(10,2) CHECK (acompte_fixe IS NULL OR (acompte_fixe >= 1 AND acompte_fixe <= prix)),
  actif boolean NOT NULL DEFAULT true,
  ordre int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, salon_id)
);
CREATE INDEX prestations_salon_idx ON public.prestations (salon_id, ordre);
CREATE TRIGGER prestations_updated_at BEFORE UPDATE ON public.prestations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- HORAIRES (0 = dimanche … 6 = samedi)
-- ============================================================
CREATE TABLE public.horaires (
  salon_id uuid NOT NULL REFERENCES public.salons(id) ON DELETE CASCADE,
  jour_semaine int NOT NULL CHECK (jour_semaine BETWEEN 0 AND 6),
  ferme boolean NOT NULL DEFAULT false,
  heure_debut time NOT NULL DEFAULT '09:00',
  heure_fin time NOT NULL DEFAULT '18:00',
  pause_debut time,
  pause_fin time,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (salon_id, jour_semaine),
  CHECK (heure_fin > heure_debut),
  CHECK ((pause_debut IS NULL) = (pause_fin IS NULL)),
  CHECK (pause_debut IS NULL OR (pause_fin > pause_debut AND pause_debut >= heure_debut AND pause_fin <= heure_fin))
);
CREATE TRIGGER horaires_updated_at BEFORE UPDATE ON public.horaires
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- INDISPONIBILITÉS (congés, formation…)
-- ============================================================
CREATE TABLE public.indisponibilites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id uuid NOT NULL REFERENCES public.salons(id) ON DELETE CASCADE,
  date_debut timestamptz NOT NULL,
  date_fin timestamptz NOT NULL,
  motif text NOT NULL DEFAULT '' CHECK (length(motif) <= 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (date_fin > date_debut)
);
CREATE INDEX indispo_salon_idx ON public.indisponibilites (salon_id, date_debut);

-- ============================================================
-- CLIENTES (fichier propre à chaque salon)
-- ============================================================
CREATE TABLE public.clientes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id uuid NOT NULL REFERENCES public.salons(id) ON DELETE CASCADE,
  prenom text NOT NULL CHECK (length(prenom) BETWEEN 1 AND 60),
  nom text NOT NULL CHECK (length(nom) BETWEEN 1 AND 60),
  email text NOT NULL CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(email) <= 160),
  telephone text NOT NULL CHECK (length(telephone) BETWEEN 6 AND 30),
  notes_privees text NOT NULL DEFAULT '' CHECK (length(notes_privees) <= 2000),
  -- Allergies / contre-indications : chiffrées par le serveur (AES-256-GCM)
  -- avant d'arriver en base. Illisibles sans la clé du serveur.
  sante_chiffree text,
  sante_consentement_le timestamptz,
  derniere_activite_le timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, salon_id),
  CHECK (sante_chiffree IS NULL OR sante_consentement_le IS NOT NULL)
);
CREATE UNIQUE INDEX clientes_salon_email_idx ON public.clientes (salon_id, lower(email));
CREATE TRIGGER clientes_updated_at BEFORE UPDATE ON public.clientes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- RÉSERVATIONS
-- ============================================================
-- Cycle de vie :
--   en_attente_paiement → (acompte payé) → a_valider → confirmee → honoree | absente
--   a_valider → refusee (acompte remboursé)
--   en_attente_paiement → annulee (délai de paiement dépassé)
--   a_valider | confirmee → annulee (par la cliente ou le salon)
CREATE TABLE public.reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id uuid NOT NULL REFERENCES public.salons(id) ON DELETE CASCADE,
  prestation_id uuid NOT NULL,
  cliente_id uuid NOT NULL,
  date_debut timestamptz NOT NULL,
  date_fin timestamptz NOT NULL,
  statut text NOT NULL DEFAULT 'en_attente_paiement' CHECK (statut IN (
    'en_attente_paiement', 'a_valider', 'confirmee', 'refusee', 'annulee', 'honoree', 'absente')),
  source text NOT NULL DEFAULT 'en_ligne' CHECK (source IN ('en_ligne', 'manuel')),
  prestation_nom text NOT NULL,
  prix_total numeric(10,2) NOT NULL CHECK (prix_total >= 0),
  acompte_montant numeric(10,2) NOT NULL DEFAULT 0 CHECK (acompte_montant >= 0 AND acompte_montant <= prix_total),
  acompte_statut text NOT NULL DEFAULT 'non_requis' CHECK (acompte_statut IN (
    'non_requis', 'en_attente', 'paye', 'rembourse', 'conserve', 'expire')),
  montant_rembourse numeric(10,2) NOT NULL DEFAULT 0 CHECK (montant_rembourse >= 0),
  acompte_expire_le timestamptz,
  acompte_paye_le timestamptz,
  stripe_payment_intent text UNIQUE,
  -- Lien personnel de la cliente (consulter / annuler), jamais devinable
  token_gestion uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  commentaire_cliente text NOT NULL DEFAULT '' CHECK (length(commentaire_cliente) <= 500),
  note_interne text NOT NULL DEFAULT '' CHECK (length(note_interne) <= 1000),
  conditions_acceptees_le timestamptz,
  rappel_envoye_le timestamptz,
  cree_le timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (date_fin > date_debut),
  -- Une réservation ne peut pas pointer vers la prestation / la cliente d'un autre salon
  FOREIGN KEY (prestation_id, salon_id) REFERENCES public.prestations (id, salon_id),
  FOREIGN KEY (cliente_id, salon_id) REFERENCES public.clientes (id, salon_id) ON DELETE CASCADE,
  -- Aucune double réservation possible dans un même salon, même en cas de clics simultanés
  CONSTRAINT reservations_sans_chevauchement EXCLUDE USING gist (
    salon_id WITH =,
    tstzrange(date_debut, date_fin) WITH &&
  ) WHERE (statut IN ('en_attente_paiement', 'a_valider', 'confirmee', 'honoree', 'absente'))
);
CREATE INDEX reservations_salon_date_idx ON public.reservations (salon_id, date_debut);
CREATE INDEX reservations_cliente_idx ON public.reservations (cliente_id);
CREATE TRIGGER reservations_updated_at BEFORE UPDATE ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- JOURNAL (traçabilité, en écriture seule)
-- ============================================================
CREATE TABLE public.journal (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  salon_id uuid REFERENCES public.salons(id) ON DELETE CASCADE,
  user_id uuid,
  action text NOT NULL,
  cible text NOT NULL,
  cible_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  cree_le timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX journal_salon_idx ON public.journal (salon_id, cree_le DESC);

CREATE OR REPLACE FUNCTION public.journaliser() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ligne jsonb := to_jsonb(coalesce(NEW, OLD));
  avant jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END;
  modifs jsonb := '{}'::jsonb;
  k text;
BEGIN
  -- On note quels champs ont changé, jamais leur contenu de santé.
  IF TG_OP = 'UPDATE' THEN
    FOR k IN SELECT jsonb_object_keys(ligne) LOOP
      IF k NOT IN ('updated_at') AND (ligne -> k) IS DISTINCT FROM (avant -> k) THEN
        modifs := modifs || jsonb_build_object(k, CASE
          WHEN k IN ('sante_chiffree', 'notes_privees', 'email', 'telephone') THEN '"(modifié)"'::jsonb
          ELSE ligne -> k END);
      END IF;
    END LOOP;
    IF modifs = '{}'::jsonb THEN RETURN NULL; END IF;
  END IF;
  INSERT INTO public.journal (salon_id, user_id, action, cible, cible_id, details)
  VALUES (
    CASE WHEN TG_TABLE_NAME = 'salons' THEN (ligne ->> 'id')::uuid ELSE (ligne ->> 'salon_id')::uuid END,
    auth.uid(),
    lower(TG_OP),
    TG_TABLE_NAME,
    ligne ->> 'id',
    modifs
  );
  RETURN NULL;
END; $$;

CREATE TRIGGER journal_salons AFTER UPDATE ON public.salons
  FOR EACH ROW EXECUTE FUNCTION public.journaliser();
CREATE TRIGGER journal_reservations AFTER INSERT OR UPDATE OR DELETE ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.journaliser();
CREATE TRIGGER journal_clientes AFTER INSERT OR UPDATE OR DELETE ON public.clientes
  FOR EACH ROW EXECUTE FUNCTION public.journaliser();
CREATE TRIGGER journal_prestations AFTER INSERT OR UPDATE OR DELETE ON public.prestations
  FOR EACH ROW EXECUTE FUNCTION public.journaliser();

-- ============================================================
-- DROITS — personne n'a accès à rien par défaut
-- ============================================================
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

ALTER TABLE public.salons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membres ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prestations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.horaires ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.indisponibilites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal ENABLE ROW LEVEL SECURITY;

-- Salons : lecture par ses membres ; seules les colonnes de présentation
-- et les règles de réservation sont modifiables, par la propriétaire.
GRANT SELECT ON public.salons TO authenticated;
GRANT UPDATE (nom, metier, ville, adresse, telephone, email_contact, instagram, description, couleur,
  acompte_pourcent, annulation_gratuite_heures, delai_min_heures, horizon_jours, pas_minutes)
  ON public.salons TO authenticated;
CREATE POLICY salons_lecture ON public.salons FOR SELECT TO authenticated
  USING (public.est_membre(id));
CREATE POLICY salons_modif ON public.salons FOR UPDATE TO authenticated
  USING (public.est_proprietaire(id)) WITH CHECK (public.est_proprietaire(id));

-- Membres : chacune voit l'équipe de ses salons ; aucune modification depuis l'appli.
GRANT SELECT ON public.membres TO authenticated;
CREATE POLICY membres_lecture ON public.membres FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.est_membre(salon_id));

-- Prestations, horaires, indisponibilités : gérées par l'équipe du salon.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prestations, public.horaires, public.indisponibilites TO authenticated;
CREATE POLICY prestations_equipe ON public.prestations FOR ALL TO authenticated
  USING (public.est_membre(salon_id)) WITH CHECK (public.est_membre(salon_id));
CREATE POLICY horaires_equipe ON public.horaires FOR ALL TO authenticated
  USING (public.est_membre(salon_id)) WITH CHECK (public.est_membre(salon_id));
CREATE POLICY indispo_equipe ON public.indisponibilites FOR ALL TO authenticated
  USING (public.est_membre(salon_id)) WITH CHECK (public.est_membre(salon_id));

-- Clientes : l'équipe lit et met à jour ses fiches. Les données de santé ne
-- s'écrivent que par le serveur (chiffrement), la suppression complète aussi
-- (elle doit effacer en cascade et être journalisée).
GRANT SELECT ON public.clientes TO authenticated;
GRANT UPDATE (prenom, nom, telephone, notes_privees) ON public.clientes TO authenticated;
CREATE POLICY clientes_lecture ON public.clientes FOR SELECT TO authenticated
  USING (public.est_membre(salon_id));
CREATE POLICY clientes_modif ON public.clientes FOR UPDATE TO authenticated
  USING (public.est_membre(salon_id)) WITH CHECK (public.est_membre(salon_id));

-- Réservations : lecture par l'équipe ; seule la note interne est modifiable
-- directement. Tout changement de statut passe par le serveur (e-mails,
-- remboursements, règles d'annulation).
GRANT SELECT ON public.reservations TO authenticated;
GRANT UPDATE (note_interne) ON public.reservations TO authenticated;
CREATE POLICY reservations_lecture ON public.reservations FOR SELECT TO authenticated
  USING (public.est_membre(salon_id));
CREATE POLICY reservations_note ON public.reservations FOR UPDATE TO authenticated
  USING (public.est_membre(salon_id)) WITH CHECK (public.est_membre(salon_id));

-- Journal : lecture par la propriétaire du salon, jamais d'écriture.
GRANT SELECT ON public.journal TO authenticated;
CREATE POLICY journal_lecture ON public.journal FOR SELECT TO authenticated
  USING (public.est_proprietaire(salon_id));

-- ============================================================
-- FONCTIONS PUBLIQUES (visiteuses) — informations publiques uniquement
-- ============================================================
CREATE OR REPLACE FUNCTION public.salon_public(p_slug text)
RETURNS TABLE (
  id uuid, slug text, nom text, metier text, ville text, adresse text, telephone text,
  instagram text, description text, couleur text, acompte_pourcent int,
  annulation_gratuite_heures int, horizon_jours int, paiements_actifs boolean, ouvert boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.slug, s.nom, s.metier, s.ville, s.adresse, s.telephone, s.instagram,
         s.description, s.couleur, s.acompte_pourcent, s.annulation_gratuite_heures,
         s.horizon_jours, s.paiements_actifs,
         (s.actif AND s.abonnement_statut IN ('essai', 'actif')
           AND (s.abonnement_statut <> 'essai' OR s.essai_fin_le > now())) AS ouvert
  FROM public.salons s
  WHERE s.slug = lower(p_slug) AND s.actif;
$$;

CREATE OR REPLACE FUNCTION public.prestations_publiques(p_slug text)
RETURNS TABLE (id uuid, nom text, description text, duree_minutes int, prix numeric, acompte numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.nom, p.description, p.duree_minutes, p.prix,
         coalesce(p.acompte_fixe, round(p.prix * s.acompte_pourcent / 100.0, 2)) AS acompte
  FROM public.prestations p
  JOIN public.salons s ON s.id = p.salon_id
  WHERE s.slug = lower(p_slug) AND s.actif AND p.actif
  ORDER BY p.ordre, p.nom;
$$;

-- Heures de début libres pour une prestation et un jour (heure locale du salon).
-- Ne renvoie que des heures : aucune information sur les autres clientes.
CREATE OR REPLACE FUNCTION public.creneaux_disponibles(p_slug text, p_date date, p_prestation uuid)
RETURNS TABLE (heure time)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s record;
  duree int;
  h record;
  curseur timestamptz;
  fin_journee timestamptz;
  fin_slot timestamptz;
BEGIN
  SELECT * INTO s FROM public.salons WHERE slug = lower(p_slug) AND actif;
  IF s IS NULL THEN RETURN; END IF;

  SELECT p.duree_minutes INTO duree FROM public.prestations p
  WHERE p.id = p_prestation AND p.salon_id = s.id AND p.actif;
  IF duree IS NULL THEN RETURN; END IF;

  IF p_date < (now() AT TIME ZONE s.fuseau)::date
     OR p_date > (now() AT TIME ZONE s.fuseau)::date + s.horizon_jours THEN RETURN; END IF;

  SELECT * INTO h FROM public.horaires
  WHERE salon_id = s.id AND jour_semaine = EXTRACT(DOW FROM p_date)::int AND NOT ferme;
  IF h IS NULL THEN RETURN; END IF;

  curseur := (p_date + h.heure_debut) AT TIME ZONE s.fuseau;
  fin_journee := (p_date + h.heure_fin) AT TIME ZONE s.fuseau;

  WHILE curseur + make_interval(mins => duree) <= fin_journee LOOP
    fin_slot := curseur + make_interval(mins => duree);
    IF curseur >= now() + make_interval(hours => s.delai_min_heures)
       AND NOT (
         h.pause_debut IS NOT NULL
         AND tstzrange(curseur, fin_slot) && tstzrange(
           (p_date + h.pause_debut) AT TIME ZONE s.fuseau,
           (p_date + h.pause_fin) AT TIME ZONE s.fuseau)
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.indisponibilites i
         WHERE i.salon_id = s.id AND tstzrange(i.date_debut, i.date_fin) && tstzrange(curseur, fin_slot)
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.reservations r
         WHERE r.salon_id = s.id
           AND r.statut IN ('en_attente_paiement', 'a_valider', 'confirmee', 'honoree', 'absente')
           -- réservation provisoire non payée à temps : le créneau est libre
           AND NOT (r.statut = 'en_attente_paiement' AND r.acompte_expire_le < now())
           AND tstzrange(r.date_debut, r.date_fin) && tstzrange(curseur, fin_slot)
       )
    THEN
      heure := (curseur AT TIME ZONE s.fuseau)::time;
      RETURN NEXT;
    END IF;
    curseur := curseur + make_interval(mins => s.pas_minutes);
  END LOOP;
END; $$;

REVOKE ALL ON FUNCTION public.salon_public(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prestations_publiques(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.creneaux_disponibles(text, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.salon_public(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prestations_publiques(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.creneaux_disponibles(text, date, uuid) TO anon, authenticated, service_role;

-- ============================================================
-- FONCTIONS SERVEUR (clé de service uniquement)
-- ============================================================

-- Libère les réservations provisoires dont le paiement n'est pas arrivé à temps.
CREATE OR REPLACE FUNCTION public.liberer_expirees(p_salon uuid DEFAULT NULL)
RETURNS SETOF text
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.reservations
  SET statut = 'annulee', acompte_statut = 'expire'
  WHERE statut = 'en_attente_paiement' AND acompte_expire_le < now()
    AND (p_salon IS NULL OR salon_id = p_salon)
  RETURNING stripe_payment_intent;
$$;

-- Crée une demande de réservation provisoire, après vérification que le créneau
-- est réellement libre. Les montants sont calculés ici, jamais par le navigateur.
CREATE OR REPLACE FUNCTION public.creer_demande(
  p_slug text,
  p_prestation uuid,
  p_date date,
  p_heure time,
  p_prenom text,
  p_nom text,
  p_email text,
  p_telephone text,
  p_commentaire text,
  p_delai_paiement_minutes int DEFAULT 35
)
RETURNS TABLE (reservation_id uuid, token uuid, acompte numeric, prix numeric, date_debut timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s record;
  p record;
  v_debut timestamptz;
  v_cliente uuid;
  v_acompte numeric;
BEGIN
  SELECT * INTO s FROM public.salons WHERE slug = lower(p_slug) AND actif;
  IF s IS NULL THEN RAISE EXCEPTION 'SALON_INCONNU'; END IF;
  IF NOT s.paiements_actifs THEN RAISE EXCEPTION 'PAIEMENTS_INACTIFS'; END IF;
  IF NOT (s.abonnement_statut = 'actif' OR (s.abonnement_statut = 'essai' AND s.essai_fin_le > now())) THEN
    RAISE EXCEPTION 'SALON_FERME';
  END IF;

  SELECT * INTO p FROM public.prestations WHERE id = p_prestation AND salon_id = s.id AND actif;
  IF p IS NULL THEN RAISE EXCEPTION 'PRESTATION_INCONNUE'; END IF;

  PERFORM public.liberer_expirees(s.id);

  IF NOT EXISTS (SELECT 1 FROM public.creneaux_disponibles(p_slug, p_date, p_prestation) c WHERE c.heure = p_heure) THEN
    RAISE EXCEPTION 'CRENEAU_INDISPONIBLE';
  END IF;

  v_debut := (p_date + p_heure) AT TIME ZONE s.fuseau;
  v_acompte := coalesce(p.acompte_fixe, round(p.prix * s.acompte_pourcent / 100.0, 2));
  IF v_acompte < 1 THEN v_acompte := least(p.prix, 1); END IF;

  INSERT INTO public.clientes (salon_id, prenom, nom, email, telephone)
  VALUES (s.id, trim(p_prenom), trim(p_nom), lower(trim(p_email)), trim(p_telephone))
  ON CONFLICT (salon_id, lower(email)) DO UPDATE
    SET derniere_activite_le = now()
  RETURNING id INTO v_cliente;

  -- La contrainte d'exclusion bloque toute réservation simultanée du même créneau.
  BEGIN
    INSERT INTO public.reservations (
      salon_id, prestation_id, cliente_id, date_debut, date_fin, statut, source,
      prestation_nom, prix_total, acompte_montant, acompte_statut, acompte_expire_le,
      commentaire_cliente, conditions_acceptees_le)
    VALUES (
      s.id, p.id, v_cliente, v_debut, v_debut + make_interval(mins => p.duree_minutes),
      'en_attente_paiement', 'en_ligne', p.nom, p.prix, v_acompte, 'en_attente',
      now() + make_interval(mins => p_delai_paiement_minutes),
      left(coalesce(p_commentaire, ''), 500), now())
    RETURNING id, token_gestion INTO reservation_id, token;
  EXCEPTION WHEN exclusion_violation THEN
    RAISE EXCEPTION 'CRENEAU_INDISPONIBLE';
  END;

  acompte := v_acompte;
  prix := p.prix;
  date_debut := v_debut;
  RETURN NEXT;
END; $$;

-- Paiement de l'acompte confirmé par Stripe (webhook signé ou vérification directe).
-- Rejouable : « nouveau » n'est vrai qu'une seule fois (e-mails envoyés une fois).
-- Paiement arrivé APRÈS l'expiration du créneau : « a_rembourser » est vrai,
-- le serveur rembourse aussitôt (le créneau a pu être donné à quelqu'un d'autre).
CREATE OR REPLACE FUNCTION public.acompte_recu(p_payment_intent text, p_montant_centimes bigint)
RETURNS TABLE (reservation_id uuid, nouveau boolean, a_rembourser boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.reservations WHERE stripe_payment_intent = p_payment_intent FOR UPDATE;
  IF r IS NULL THEN RETURN; END IF;
  reservation_id := r.id;
  IF r.acompte_statut IN ('paye', 'rembourse', 'conserve') THEN
    nouveau := false; a_rembourser := false; RETURN NEXT; RETURN;
  END IF;
  IF round(r.acompte_montant * 100) <> p_montant_centimes THEN
    RAISE EXCEPTION 'MONTANT_INCOHERENT';
  END IF;
  UPDATE public.reservations
  SET acompte_statut = 'paye', acompte_paye_le = now(),
      statut = CASE WHEN statut = 'en_attente_paiement' THEN 'a_valider' ELSE statut END
  WHERE id = r.id;
  nouveau := true;
  a_rembourser := r.statut <> 'en_attente_paiement';
  RETURN NEXT;
END; $$;

-- Changement de statut décidé par le salon, avec les règles de passage autorisées.
CREATE OR REPLACE FUNCTION public.changer_statut(p_reservation uuid, p_statut text, p_user uuid)
RETURNS TABLE (ancien text, nouveau text, remboursable numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  autorise boolean;
BEGIN
  SELECT * INTO r FROM public.reservations WHERE id = p_reservation FOR UPDATE;
  IF r IS NULL THEN RAISE EXCEPTION 'RESERVATION_INCONNUE'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.membres WHERE salon_id = r.salon_id AND user_id = p_user) THEN
    RAISE EXCEPTION 'ACCES_REFUSE';
  END IF;
  autorise := (r.statut, p_statut) IN (
    ('a_valider', 'confirmee'), ('a_valider', 'refusee'),
    ('confirmee', 'annulee'), ('confirmee', 'honoree'), ('confirmee', 'absente'),
    ('honoree', 'absente'), ('absente', 'honoree'));
  IF NOT autorise THEN RAISE EXCEPTION 'TRANSITION_INTERDITE'; END IF;
  UPDATE public.reservations SET statut = p_statut,
    acompte_statut = CASE WHEN p_statut = 'absente' AND acompte_statut = 'paye' THEN 'conserve'
                          WHEN p_statut = 'honoree' AND acompte_statut = 'conserve' THEN 'paye'
                          ELSE acompte_statut END
  WHERE id = r.id;
  ancien := r.statut;
  nouveau := p_statut;
  remboursable := CASE WHEN r.acompte_statut = 'paye' THEN r.acompte_montant - r.montant_rembourse ELSE 0 END;
  RETURN NEXT;
END; $$;

-- Annulation par la cliente avec son lien personnel.
-- Renvoie le montant à rembourser (0 si annulation tardive : acompte conservé).
CREATE OR REPLACE FUNCTION public.annuler_par_cliente(p_token uuid)
RETURNS TABLE (reservation_id uuid, a_rembourser numeric, tardive boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; s record;
BEGIN
  SELECT * INTO r FROM public.reservations WHERE token_gestion = p_token FOR UPDATE;
  IF r IS NULL OR r.statut NOT IN ('a_valider', 'confirmee') OR r.date_debut <= now() THEN
    RAISE EXCEPTION 'ANNULATION_IMPOSSIBLE';
  END IF;
  SELECT * INTO s FROM public.salons WHERE id = r.salon_id;
  tardive := r.date_debut < now() + make_interval(hours => s.annulation_gratuite_heures)
             AND r.statut = 'confirmee';
  UPDATE public.reservations
  SET statut = 'annulee',
      acompte_statut = CASE WHEN tardive AND acompte_statut = 'paye' THEN 'conserve' ELSE acompte_statut END
  WHERE id = r.id;
  reservation_id := r.id;
  a_rembourser := CASE WHEN tardive OR r.acompte_statut <> 'paye' THEN 0
                       ELSE r.acompte_montant - r.montant_rembourse END;
  RETURN NEXT;
END; $$;

-- Enregistre le TOTAL remboursé connu de Stripe pour un paiement (valeur absolue :
-- rejouer le même événement ne compte jamais deux fois le remboursement).
CREATE OR REPLACE FUNCTION public.remboursement_enregistre(p_payment_intent text, p_total_centimes bigint)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.reservations
  SET montant_rembourse = least(acompte_montant, greatest(montant_rembourse, p_total_centimes / 100.0)),
      acompte_statut = CASE WHEN p_total_centimes / 100.0 >= acompte_montant THEN 'rembourse' ELSE acompte_statut END
  WHERE stripe_payment_intent = p_payment_intent;
$$;

-- Purge RGPD : clientes sans activité depuis N mois, et données de santé de plus de 3 ans.
CREATE OR REPLACE FUNCTION public.purger_donnees(p_mois_inactivite int DEFAULT 36)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  UPDATE public.clientes SET sante_chiffree = NULL, sante_consentement_le = NULL
  WHERE sante_consentement_le < now() - interval '3 years';
  DELETE FROM public.clientes c
  WHERE c.derniere_activite_le < now() - make_interval(months => p_mois_inactivite)
    AND NOT EXISTS (SELECT 1 FROM public.reservations r WHERE r.cliente_id = c.id AND r.date_debut > now());
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END; $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.liberer_expirees(uuid)',
    'public.creer_demande(text, uuid, date, time, text, text, text, text, text, int)',
    'public.acompte_recu(text, bigint)',
    'public.changer_statut(uuid, text, uuid)',
    'public.annuler_par_cliente(uuid)',
    'public.remboursement_enregistre(text, bigint)',
    'public.purger_donnees(int)',
    'public.journaliser()',
    'public.set_updated_at()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.est_membre(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.est_proprietaire(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.est_membre(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.est_proprietaire(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.session_securisee() TO authenticated, service_role;
