#!/usr/bin/env bash
#
# Regenerate the SeaORM entities in common/src/entities/ from the migrations.
# The `makemigrations`→codegen half of the dev loop (see .llm/build-and-run.md).
#
#   1. Build a throwaway dev.db at migration head with Atlas.
#   2. Codegen entities from that DB with sea-orm-cli.
#   3. Normalize SQLite's loose numeric typing to the domain types.
#
# Run from anywhere; it operates on the repo root. Requires `atlas` and
# `sea-orm-cli` on PATH (dev-time tools — never shipped in the .dmg).
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

cleanup() { rm -f dev.db dev.db-shm dev.db-wal; }
trap cleanup EXIT
cleanup

atlas migrate apply --env local --url "sqlite://dev.db"

sea-orm-cli generate entity \
  --database-url "sqlite://dev.db" \
  --output-dir common/src/entities \
  --ignore-tables atlas_schema_revisions

# SQLite has no i32/i64 distinction and reports REAL loosely, so sea-orm-cli
# infers `integer` as i32 and `real` as Decimal. Our millis timestamps overflow
# i32 and our ordering keys are f64 (which also can't derive Eq), so normalize:
#   created_at / updated_at : i32     -> i64
#   sort_order              : Decimal -> f64
#   Model derive            : drop Eq (f64 is not Eq)
find common/src/entities -name '*.rs' -print0 | while IFS= read -r -d '' f; do
  sed -i '' \
    -e 's/pub created_at: i32,/pub created_at: i64,/' \
    -e 's/pub updated_at: i32,/pub updated_at: i64,/' \
    -e 's/pub sort_order: Decimal,/pub sort_order: f64,/' \
    -e 's/#\[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)\]/#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]/' \
    "$f"
done

echo "Entities regenerated in common/src/entities/"
