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
  cd apps/eve-corporation-data && bun run db:generate
  cd apps/eve-character-data && bun run db:generate
  cd apps/eve-static-data && bun run db:generate
  cd apps/eve-token-store && bun run db:generate

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
  cd apps/eve-corporation-data && bun run db:push
  cd apps/eve-character-data && bun run db:push
  cd apps/eve-static-data && bun run db:push
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
  cd apps/eve-corporation-data && bun run db:migrate
  cd apps/eve-character-data && bun run db:migrate
  cd apps/eve-static-data && bun run db:migrate
  cd apps/eve-token-store && bun run db:migrate

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

# Run dev script. Runs turbo dev if not in a specific project directory.
[group('2. local dev')]
[no-cd]
dev *flags:
  bun runx dev {{flags}}

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
  bun turbo -F {{worker}} tail

[group('5. utility')]
tail-all *flags:
  #!/usr/bin/env bash
  set -euo pipefail
  [ -f .env ] && set -a && source .env && set +a
  bun turbo {{flags}} -F "./apps/*" tail
