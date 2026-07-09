// Atlas project config (dev-time only — never shipped in the .dmg).
//
// `atlas.hcl` is the project/env config; `common/schema.hcl` is the desired
// schema (the "models"). The dev loop:
//
//   atlas migrate diff <name> --env local   # autogenerate SQL migration
//   atlas migrate apply --env local --url sqlite://dev.db
//
// Run from the repo root so the relative `file://common/...` paths resolve.
env "local" {
  src = "file://common/schema.hcl"
  dev = "sqlite://dev?mode=memory"
  migration {
    dir = "file://common/migrations"
  }
}
