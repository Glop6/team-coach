#!/bin/bash
# Respaldo completo (pg_dump, formato custom) en ~/Backups/supabase/AAAA-MM-DD/. Correrlo después de cada carga mensual.
# Uso: scripts/respaldo.sh            → Team Coach
#      scripts/respaldo.sh --ms-dash  → Team Coach y MS Dash (mientras MS Dash siga activo)
# Pide la contraseña de cada base al ejecutarse; no se guarda en ningún lado. Requiere Docker.
set -euo pipefail
# Las conexiones se pueden cambiar con TEAM_COACH_URL / MS_DASH_URL, y la carpeta con BACKUP_DIR (por ejemplo, para probar en local).
TEAM_COACH=${TEAM_COACH_URL:-"postgresql://postgres.sumxpfedmslrjalhebcd@aws-1-us-west-2.pooler.supabase.com:5432/postgres?sslmode=require"}
MS_DASH=${MS_DASH_URL:-"postgresql://postgres.sakjfafycydclyqjharg@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require"}
TTY=$([ -t 0 ] && echo "-it" || echo "-i")

DIR=${BACKUP_DIR:-~/Backups/supabase/$(date +%F)}
mkdir -p "$DIR" && chmod 700 "$DIR"

respaldar() {  # nombre, conexión
  local archivo="$DIR/$1.dump"
  if [ -e "$archivo" ]; then echo "Ya existe $archivo; no se sobrescribe."; exit 1; fi
  echo "== $1 (contraseña de la base de $1)"
  docker run --rm $TTY ${PGPASSWORD:+-e PGPASSWORD} -v "$DIR":/out postgres:17 pg_dump "$2" -Fc -f "/out/$1.dump"
  chmod 600 "$archivo"
  # Verificación: el archivo se abre y trae datos
  local tablas
  tablas=$(docker run --rm -v "$DIR":/in:ro postgres:17 pg_restore -l "/in/$1.dump" | grep -c "TABLE DATA")
  [ "$tablas" -gt 0 ] || { echo "ERROR: $archivo no tiene datos"; exit 1; }
  echo "   OK: $archivo ($(du -h "$archivo" | cut -f1), $tablas tablas con datos)"
}

respaldar team-coach "$TEAM_COACH"
[ "${1:-}" = "--ms-dash" ] && respaldar ms-dash "$MS_DASH"
echo "Respaldos en $DIR"
