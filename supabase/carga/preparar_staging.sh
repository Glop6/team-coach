#!/bin/bash
# Arma el SQL que copia las tablas de MS Dash a un schema temporal "perf_staging" (paso previo a perf_carga.sql).
# Uso: supabase/carga/preparar_staging.sh <respaldo de MS Dash .dump> <archivo de salida .sql>
# La salida tiene datos del equipo: guárdala junto a los respaldos, nunca en el repo.
set -euo pipefail
DUMP=$(cd "$(dirname "$1")" && pwd)/$(basename "$1"); OUT=$2
TABLAS="-t people -t user_roles -t upload_batches -t records -t qa_records -t qa_categories -t app_settings -t data_epoch -t ai_usage"
{
  echo "drop schema if exists perf_staging cascade; create schema perf_staging; revoke all on schema perf_staging from public, anon, authenticated;"
  docker run --rm -v "$(dirname "$DUMP")":/in:ro postgres:17 \
    pg_restore -f - --section=pre-data --section=data -n public $TABLAS "/in/$(basename "$DUMP")" |
  # public. → perf_staging. en la estructura y en los COPY, sin tocar el contenido de los datos
  awk 'incopy==1 { print; if ($0=="\\.") incopy=0; next }
       /^COPY / { gsub(/public\./,"perf_staging."); print; incopy=1; next }
       { gsub(/public\./,"perf_staging."); print }'
} > "$OUT"
chmod 600 "$OUT"
echo "Listo: $OUT ($(grep -c '^COPY ' "$OUT") tablas)"
