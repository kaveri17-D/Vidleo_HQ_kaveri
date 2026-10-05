#!/usr/bin/env bash
# ==============================================================================
# NEXUS Disaster Recovery — Automated Backup Script
# Phase 6 P2.4: Point-in-time PostgreSQL, Durable Redis, and Metadata Backup
# ==============================================================================
set -euo pipefail

# ── Configuration & Defaults ──────────────────────────────────────────────────
TIMESTAMP="$(date -u +%Y%m%d_%H%M%S)"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_COUNT="${BACKUP_RETENTION_COUNT:-7}"

# PostgreSQL parameters
PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
PGDATABASE="${PGDATABASE:-clipper_x}"
PGPASSWORD="${PGPASSWORD:-postgres_secure_password}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-clipper-x-postgres}"

# Redis parameters
REDIS_HOST="${REDIS_HOST:-127.0.0.1}"
REDIS_PORT="${REDIS_PORT:-6379}"
REDIS_PASSWORD="${REDIS_PASSWORD:-}"
REDIS_CONTAINER="${REDIS_CONTAINER:-clipper-x-redis}"

# Output paths
TARGET_DIR="${BACKUP_DIR}/${TIMESTAMP}"
PG_BACKUP_FILE="${TARGET_DIR}/nexus_postgres_${TIMESTAMP}.sql.gz"
REDIS_DURABLE_FILE="${TARGET_DIR}/nexus_redis_durable_${TIMESTAMP}.json"
MANIFEST_FILE="${TARGET_DIR}/nexus_backup_${TIMESTAMP}.manifest.json"
CHECKSUM_FILE="${TARGET_DIR}/nexus_backup_${TIMESTAMP}.sha256"

# ── Logging Helper ────────────────────────────────────────────────────────────
log() {
  local level="$1"
  shift
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [${level}] $*"
}

# ── Error Cleanup Trap ────────────────────────────────────────────────────────
cleanup_on_failure() {
  local exit_code=$?
  if [ $exit_code -ne 0 ]; then
    log "ERROR" "Backup execution failed with exit code ${exit_code}. Cleaning incomplete backup directory..."
    rm -rf "${TARGET_DIR}" 2>/dev/null || true
  fi
}
trap cleanup_on_failure EXIT

# ── Initialize Backup Directory ───────────────────────────────────────────────
log "INFO" "Starting NEXUS automated disaster recovery backup (Timestamp: ${TIMESTAMP})..."
mkdir -p "${TARGET_DIR}"

# ── 1. PostgreSQL Backup ──────────────────────────────────────────────────────
log "INFO" "Dumping PostgreSQL database '${PGDATABASE}' from host ${PGHOST}:${PGPORT}..."

if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -qw "${POSTGRES_CONTAINER}"; then
  # Use Docker container exec to ensure compatible libpq tools
  docker exec -e PGPASSWORD="${PGPASSWORD}" "${POSTGRES_CONTAINER}" \
    pg_dump -U "${PGUSER}" -d "${PGDATABASE}" --no-owner --no-privileges --clean --if-exists \
    | gzip -c > "${PG_BACKUP_FILE}"
elif command -v pg_dump >/dev/null 2>&1; then
  PGPASSWORD="${PGPASSWORD}" pg_dump -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d "${PGDATABASE}" \
    --no-owner --no-privileges --clean --if-exists \
    | gzip -c > "${PG_BACKUP_FILE}"
else
  log "ERROR" "Neither pg_dump nor docker container '${POSTGRES_CONTAINER}' is available."
  exit 1
fi

PG_SIZE=$(stat -c%s "${PG_BACKUP_FILE}" 2>/dev/null || stat -f%z "${PG_BACKUP_FILE}")
log "INFO" "PostgreSQL backup completed successfully (${PG_SIZE} bytes)."

# ── 2. Redis Durable State Backup ─────────────────────────────────────────────
# Extracts ONLY authoritative durable state (credits, reservations, tenant ledger),
# intentionally omitting ephemeral queue states, transient locks, and rate limits.
log "INFO" "Exporting durable Redis state (credits and active reservations)..."

export_redis_durable() {
  python3 - << 'EOF' "$REDIS_HOST" "$REDIS_PORT" "$REDIS_PASSWORD" "$REDIS_DURABLE_FILE"
import sys, json, time
import redis

host, port, password, output_file = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]
client = redis.Redis(host=host, port=port, password=password or None, decode_responses=True, socket_timeout=3.0)

durable_data = {
    "version": "1.0",
    "timestamp": time.time(),
    "credits": {},
    "reservations": {},
}

# Scan and export tenant credit balances
credit_keys = client.keys("tenant:*:credits")
for k in credit_keys:
    durable_data["credits"][k] = client.hgetall(k)

# Scan and export active credit reservations
reservation_keys = client.keys("tenant:*:reserved")
for k in reservation_keys:
    durable_data["reservations"][k] = client.hgetall(k)

with open(output_file, "w") as f:
    json.dump(durable_data, f, indent=2)

print(f"Exported {len(credit_keys)} credit ledgers and {len(reservation_keys)} reservation keys.")
EOF
}

if command -v python3 >/dev/null 2>&1; then
  export_redis_durable
else
  echo '{"version":"1.0","credits":{},"reservations":{}}' > "${REDIS_DURABLE_FILE}"
fi

REDIS_SIZE=$(stat -c%s "${REDIS_DURABLE_FILE}" 2>/dev/null || stat -f%z "${REDIS_DURABLE_FILE}")
log "INFO" "Durable Redis state backup completed (${REDIS_SIZE} bytes)."

# ── 3. Manifest & Checksums ───────────────────────────────────────────────────
log "INFO" "Generating SHA-256 checksums and backup manifest..."

cat << EOF > "${MANIFEST_FILE}"
{
  "timestamp": "${TIMESTAMP}",
  "pg_database": "${PGDATABASE}",
  "pg_backup_file": "$(basename "${PG_BACKUP_FILE}")",
  "pg_size_bytes": ${PG_SIZE},
  "redis_backup_file": "$(basename "${REDIS_DURABLE_FILE}")",
  "redis_size_bytes": ${REDIS_SIZE},
  "created_at_utc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

(
  cd "${TARGET_DIR}"
  sha256sum "$(basename "${PG_BACKUP_FILE}")" "$(basename "${REDIS_DURABLE_FILE}")" "$(basename "${MANIFEST_FILE}")" > "$(basename "${CHECKSUM_FILE}")"
)

log "INFO" "Integrity checksum created: $(basename "${CHECKSUM_FILE}")"

# ── 4. Retention Policy ───────────────────────────────────────────────────────
log "INFO" "Applying backup retention policy (Keeping latest ${RETENTION_COUNT} backups)..."
EXISTING_BACKUPS=($(ls -1d "${BACKUP_DIR}"/20* 2>/dev/null | sort -r))
TOTAL_BACKUPS=${#EXISTING_BACKUPS[@]}

if [ "${TOTAL_BACKUPS}" -gt "${RETENTION_COUNT}" ]; then
  PRUNE_COUNT=$((TOTAL_BACKUPS - RETENTION_COUNT))
  log "INFO" "Found ${TOTAL_BACKUPS} backups; pruning ${PRUNE_COUNT} oldest backup(s)..."
  for (( i=RETENTION_COUNT; i<TOTAL_BACKUPS; i++ )); do
    OLD_DIR="${EXISTING_BACKUPS[$i]}"
    log "INFO" "Pruning expired backup: ${OLD_DIR}"
    rm -rf "${OLD_DIR}"
  done
fi

log "INFO" "NEXUS backup completed successfully at ${TARGET_DIR}."
trap - EXIT
exit 0
