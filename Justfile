# This Justfile isn't strictly necessary, but it's
# a convenient way to run commands in the repo
# without needing to remember all commands.

[private]
@help:
  just --list

# Aliases
alias new-pkg := new-package
alias new-worker := gen
alias new-do := new-durable-object
alias up := update
alias i := install

# =============================== #
#         DEV COMMANDS            #
# =============================== #

# Install dependencies
[group('1. dev')]
install:
  pnpm install --child-concurrency=10

# Check for issues with deps, lint, types, format, etc.
[group('1. dev')]
[no-cd]
check *flags:
  bun runx check {{flags}}

# Fix issues with deps, lint, format, etc.
[group('1. dev')]
[no-cd]
fix *flags:
  bun runx fix {{flags}}

[group('1. dev')]
[no-cd]
test *flags:
  bun vitest {{flags}}

[group('1. dev')]
[no-cd]
build *flags:
  bun turbo build {{flags}}

# =============================== #
#       LOCAL DEV COMMANDS        #
# =============================== #

# Bootstrap local dev env: create .env (if missing), then migrate core DB.
[group('2. local dev')]
dev-local-init:
  #!/usr/bin/env bash
  set -euo pipefail
  if [ ! -f .env ]; then
    if [ -f .env.example.local ]; then
      cp .env.example.local .env
      echo "Created .env from .env.example.local"
    else
      echo ".env.example.local not found; create .env manually" >&2
      exit 1
    fi
  fi
  DB_URL="$(awk -F= '/^DATABASE_URL_MIGRATIONS=/{print substr($0, index($0, "=") + 1)}' .env | tail -n 1)"
  if [ -z "$DB_URL" ]; then
    echo "DATABASE_URL_MIGRATIONS is missing in .env (set your Neon migrations URL)" >&2
    exit 1
  fi
  if [[ "$DB_URL" == *"localhost"* || "$DB_URL" == *"127.0.0.1"* ]]; then
    echo "DATABASE_URL_MIGRATIONS points to localhost; this flow expects a Neon URL." >&2
    exit 1
  fi
  bun run --cwd apps/core db:migrate
  bun run --cwd apps/admin db:migrate
  bun run --cwd apps/corporation-tax db:migrate
  echo "Local init complete. Run: just dev-local"

# =============================== #
#       DATABASE COMMANDS         #
# =============================== #

# Generate migrations for all apps
[group('2. database')]
db-generate-all:
  cd apps/core && bun run db:generate
  cd apps/discord && bun run db:generate
  cd apps/groups && bun run db:generate
  cd apps/admin && bun run db:generate
  cd apps/bills && bun run db:generate
  cd apps/orchestrator && bun run db:generate
  cd apps/broadcasts && bun run db:generate
  cd apps/features && bun run db:generate
  cd apps/fleets && bun run db:generate
  cd apps/hr && bun run db:generate
  cd apps/skills && bun run db:generate
  cd apps/freight && bun run db:generate
  cd apps/markets && bun run db:generate
  cd apps/industry && bun run db:generate
  cd apps/universe && bun run db:generate
  cd apps/srp && bun run db:generate
  cd apps/doctrines && bun run db:generate
  cd apps/strife && bun run db:generate
  cd apps/fulcrum && bun run db:generate
  cd apps/fulcrum && bun run db:generate
  cd apps/beancounter && bun run db:generate
  cd apps/esi && bun run db:generate
  cd apps/donations && bun run db:generate
  cd apps/postman && bun run db:generate
  cd apps/mumble && bun run db:generate
  cd apps/eve-corporation-data && bun run db:generate
  cd apps/eve-character-data && bun run db:generate
  cd apps/eve-token-store && bun run db:generate
  cd apps/moon-scan && bun run db:generate

# Push schema changes to database (for development)
[group('2. database')]
db-push-all:
  cd apps/core && bun run db:push
  cd apps/discord && bun run db:push
  cd apps/groups && bun run db:push
  cd apps/admin && bun run db:push
  cd apps/bills && bun run db:push
  cd apps/orchestrator && bun run db:push
  cd apps/broadcasts && bun run db:push
  cd apps/features && bun run db:push
  cd apps/fleets && bun run db:push
  cd apps/hr && bun run db:push
  cd apps/skills && bun run db:push
  cd apps/freight && bun run db:push
  cd apps/markets && bun run db:push
  cd apps/industry && bun run db:push
  cd apps/universe && bun run db:push
  cd apps/srp && bun run db:push
  cd apps/doctrines && bun run db:push
  cd apps/strife && bun run db:push
  cd apps/fulcrum && bun run db:push
  cd apps/fulcrum && bun run db:push
  cd apps/beancounter && bun run db:push
  cd apps/esi && bun run db:push
  cd apps/donations && bun run db:push
  cd apps/postman && bun run db:push
  cd apps/mumble && bun run db:push
  cd apps/eve-corporation-data && bun run db:push
  cd apps/eve-character-data && bun run db:push
  cd apps/eve-token-store && bun run db:push

# Run migrations for all apps
[group('2. database')]
db-migrate-all:
  cd apps/core && bun run db:migrate
  cd apps/discord && bun run db:migrate
  cd apps/groups && bun run db:migrate
  cd apps/admin && bun run db:migrate
  cd apps/bills && bun run db:migrate
  cd apps/orchestrator && bun run db:migrate
  cd apps/broadcasts && bun run db:migrate
  cd apps/features && bun run db:migrate
  cd apps/fleets && bun run db:migrate
  cd apps/hr && bun run db:migrate
  cd apps/skills && bun run db:migrate
  cd apps/freight && bun run db:migrate
  cd apps/markets && bun run db:migrate
  cd apps/industry && bun run db:migrate
  cd apps/universe && bun run db:migrate
  cd apps/srp && bun run db:migrate
  cd apps/doctrines && bun run db:migrate
  cd apps/strife && bun run db:migrate
  cd apps/fulcrum && bun run db:migrate
  cd apps/fulcrum && bun run db:migrate
  cd apps/beancounter && bun run db:migrate
  cd apps/esi && bun run db:migrate
  cd apps/corporation-tax && bun run db:migrate
  cd apps/donations && bun run db:migrate
  cd apps/postman && bun run db:migrate
  cd apps/mumble && bun run db:migrate
  cd apps/eve-corporation-data && bun run db:migrate
  cd apps/eve-character-data && bun run db:migrate
  cd apps/eve-token-store && bun run db:migrate
  cd apps/moon-scan && bun run db:migrate

# Seed moon permissions into groups DB
[group('2. database')]
db-seed-moon-permissions:
  cd apps/groups && bun run db:seed-moon-permissions

# Seed moon-scan static data (ore rarities, structure profiles)
[group('2. database')]
db-seed-moon-scan:
  cd apps/moon-scan && bun run db:seed

# Open Drizzle Studio for a specific app
[group('2. database')]
db-studio app:
  cd apps/{{app}} && bun run db:studio

# Generate migrations for a specific app
[group('2. database')]
db-generate app:
  cd apps/{{app}} && bun run db:generate

# Push schema for a specific app
[group('2. database')]
db-push app:
  cd apps/{{app}} && bun run db:push

# Run migrations for a specific app
[group('2. database')]
db-migrate app:
  cd apps/{{app}} && bun run db:migrate

# Legacy snapshot import helpers
[group('2. database')]
legacy-snapshot-extract stage='all' snapshot_dir='./tmp/legacy-snapshot' batch_size='100':
  pnpm -F legacy db:import:snapshot -- --stage {{stage}} --extract-only --snapshot-dir {{snapshot_dir}} --batch-size {{batch_size}}

[group('2. database')]
legacy-snapshot-dry-run stage='all' snapshot_dir='./tmp/legacy-snapshot' from_snapshot='false' batch_size='100':
  #!/usr/bin/env bash
  set -euo pipefail
  cmd=(pnpm -F legacy db:import:snapshot -- --stage {{stage}} --dry-run --snapshot-dir {{snapshot_dir}} --batch-size {{batch_size}})
  if [ "{{from_snapshot}}" = "true" ]; then
    cmd+=(--from-snapshot)
  fi
  "${cmd[@]}"

[group('2. database')]
legacy-snapshot-apply stage='all' snapshot_dir='./tmp/legacy-snapshot' from_snapshot='false' batch_size='100' prune_stale='true':
  #!/usr/bin/env bash
  set -euo pipefail
  cmd=(pnpm -F legacy db:import:snapshot -- --stage {{stage}} --apply --snapshot-dir {{snapshot_dir}} --batch-size {{batch_size}})
  if [ "{{from_snapshot}}" = "true" ]; then
    cmd+=(--from-snapshot)
  fi
  if [ "{{prune_stale}}" != "true" ]; then
    cmd+=(--no-prune-stale)
  fi
  "${cmd[@]}"

[group('2. database')]
legacy-snapshot-resume stage='all' snapshot_dir='./tmp/legacy-snapshot' from_snapshot='true' batch_size='100' prune_stale='true':
  #!/usr/bin/env bash
  set -euo pipefail
  cmd=(pnpm -F legacy db:import:snapshot -- --stage {{stage}} --apply --resume --snapshot-dir {{snapshot_dir}} --batch-size {{batch_size}})
  if [ "{{from_snapshot}}" = "true" ]; then
    cmd+=(--from-snapshot)
  fi
  if [ "{{prune_stale}}" != "true" ]; then
    cmd+=(--no-prune-stale)
  fi
  "${cmd[@]}"

[group('2. database')]
legacy-snapshot-reset-cursor snapshot_dir='./tmp/legacy-snapshot':
  pnpm -F legacy db:import:snapshot -- --stage all --dry-run --snapshot-dir {{snapshot_dir}} --reset-cursor

[group('2. database')]
legacy-snapshot-clear-temp snapshot_dir='./tmp/legacy-snapshot':
  #!/usr/bin/env bash
  set -euo pipefail
  if [ -d "{{snapshot_dir}}" ]; then
    rm -rf "{{snapshot_dir}}"
    echo "Removed snapshot temp directory: {{snapshot_dir}}"
  else
    echo "Snapshot temp directory not found: {{snapshot_dir}}"
  fi

[group('2. database')]
legacy-blacklist-import:
  pnpm -F hr db:import:legacy-blacklist -- --apply

[group('2. database')]
legacy-blacklist-dry-run export_dir='./tmp/legacy-blacklist':
  pnpm -F hr db:import:legacy-blacklist -- --dry-run --export {{export_dir}}

[group('2. database')]
legacy-blacklist-resume export_dir='./tmp/legacy-blacklist':
  pnpm -F hr db:import:legacy-blacklist -- --apply --export {{export_dir}} --resume

[group('2. database')]
legacy-blacklist-reset-cursor export_dir='./tmp/legacy-blacklist':
  pnpm -F hr db:import:legacy-blacklist -- --dry-run --export {{export_dir}} --reset-cursor

# Run dev script. Runs turbo dev if not in a specific project directory.
[group('2. local dev')]
[no-cd]
dev *flags:
  bun runx dev {{flags}}

# Run local dev using bun-only pathway (opt-in).
[group('2. local dev')]
[no-cd]
dev-local *flags:
  bun runx dev-local {{flags}}

# Run Workers in preview mode (if available)
[group('2. local dev')]
[no-cd]
preview:
  bun run preview

# Deploy Workers
[group('2. local dev')]
[no-cd]
deploy *flags:
  bun turbo deploy {{flags}}

# =============================== #
#       GENERATOR COMMANDS        #
# =============================== #

# Create changeset
[group('3. generator')]
cs:
  bun run-changeset-new

[group('3. generator')]
gen *flags:
  bun run-turbo-gen {{flags}}

[group('3. generator')]
new-package *flags:
  bun run-turbo-gen new-package {{flags}}

[group('3. generator')]
new-durable-object *flags:
  bun run-turbo-gen new-durable-object {{flags}}

# =============================== #
#        UTILITY COMMANDS         #
# =============================== #

# CLI in packages/tools for updating deps, pnpm, etc.
[group('5. utility')]
update *flags:
  bun runx update {{flags}}

# CLI in packages/tools for running commands in the repo.
[group('5. utility')]
runx *flags:
  bun runx {{flags}}

[group('5. utility')]
tail worker:
  #!/usr/bin/env bash
  set -euo pipefail
  [ -f .env ] && set -a && source .env && set +a
  IFS=',' read -r -a workers <<< "{{worker}}"
  turbo_filters=()
  for worker_name in "${workers[@]}"; do
    # trim leading/trailing whitespace
    worker_name="${worker_name#"${worker_name%%[![:space:]]*}"}"
    worker_name="${worker_name%"${worker_name##*[![:space:]]}"}"
    [ -z "$worker_name" ] && continue
    turbo_filters+=("-F" "$worker_name")
  done

  if [ "${#turbo_filters[@]}" -eq 0 ]; then
    echo "No worker names provided. Usage: just tail core,groups" >&2
    exit 1
  fi

  bun turbo "${turbo_filters[@]}" tail

[group('5. utility')]
tail-all *flags:
  #!/usr/bin/env bash
  set -euo pipefail
  [ -f .env ] && set -a && source .env && set +a
  bun turbo {{flags}} -F "./apps/*" tail
