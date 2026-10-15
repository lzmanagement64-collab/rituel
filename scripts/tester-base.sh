#!/usr/bin/env bash
# ============================================================
# Lance les tests de sécurité de la base sur un PostgreSQL jetable.
#   - avec DATABASE_URL défini : utilise cette base (VIDE, jamais la production)
#   - sinon : crée une base temporaire avec PostgreSQL installé sur la machine
# Usage : bash scripts/tester-base.sh
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."

appliquer() {
  local url="$1"
  psql "$url" -q -v ON_ERROR_STOP=1 -f supabase/tests/00_simulation_supabase.sql
  for f in supabase/migrations/*.sql; do
    psql "$url" -q -v ON_ERROR_STOP=1 -f "$f"
  done
  psql "$url" -v ON_ERROR_STOP=1 -f supabase/tests/10_securite.sql
  # Le modèle de création de salon doit fonctionner tel quel
  psql "$url" -q -v ON_ERROR_STOP=1 -c "INSERT INTO auth.users (email) VALUES ('modele@exemple.test')"
  sed "s/<<adresse-du-salon>>/salon-modele/g; s/<<Nom du salon>>/Salon modèle/; s/<<Ville>>/Pau/; s/<<téléphone>>/0600000000/; s/<<email@du-salon.fr>>/modele@exemple.test/g" \
    scripts/creer-salon.sql | psql "$url" -q -v ON_ERROR_STOP=1 -o /dev/null
  local n
  n=$(psql "$url" -tA -c "SELECT count(*) FROM public.horaires h JOIN public.salons s ON s.id = h.salon_id JOIN public.membres m ON m.salon_id = s.id WHERE s.slug = 'salon-modele' AND m.role = 'proprietaire'")
  [[ "$n" == "7" ]] || { echo "ÉCHEC : scripts/creer-salon.sql ne crée pas le salon correctement"; exit 1; }
  echo "Modèle de création de salon : OK"
}

if [[ -n "${DATABASE_URL:-}" ]]; then
  appliquer "$DATABASE_URL"
  exit 0
fi

PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
[[ -z "$PGBIN" ]] && PGBIN="$(dirname "$(command -v initdb)")"
DIR="$(mktemp -d)"
PORT=$(( 54000 + RANDOM % 1000 ))
LANCER=()
if [[ "$(id -u)" == "0" ]]; then
  chown postgres "$DIR"
  LANCER=(runuser -u postgres --)
fi
"${LANCER[@]}" "$PGBIN/initdb" -D "$DIR/data" -U postgres --auth=trust -E UTF8 >/dev/null
"${LANCER[@]}" "$PGBIN/pg_ctl" -D "$DIR/data" -o "-p $PORT -k $DIR -c listen_addresses=''" -l "$DIR/log" -w start >/dev/null
trap '"${LANCER[@]}" "$PGBIN/pg_ctl" -D "$DIR/data" -m fast stop >/dev/null; rm -rf "$DIR"' EXIT
appliquer "postgresql://postgres@/postgres?host=$DIR&port=$PORT"
