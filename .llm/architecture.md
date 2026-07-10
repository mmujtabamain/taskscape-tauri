# Architecture

## Two apps, one crate, one database

```
taskscape-tauri/         # npm workspace (main + tray + common-ui)
├── common/       # shared Rust library (taskscape_common)
├── common-ui/    # shared React/TS UI lib (@taskscape/common-ui)
├── main/         # full task-manager window  (Tauri app, pkg taskscape-main)
├── tray/         # menu-bar agent + mini bar  (Tauri app, pkg taskscape-tray)
└── scripts/
    ├── run-dev.sh    # run both apps in dev   (npm run dev)
    └── make-app.sh   # build + package .dmg   (npm run build)
```

Both apps — `main` and `tray` (packages `taskscape-main` / `taskscape-tray`) — are **standalone Tauri v2 apps** with their own `src-tauri/` (Rust) and `src/` (React + TypeScript + Vite). They both depend on the local `common` Rust crate and the shared `@taskscape/common-ui` frontend package.

## Why two processes?

The menu-bar capture bar must be _always available and instant_ — it runs as a lightweight macOS **Accessory** agent (no dock icon) so it can pop up over any app, including other apps' native full-screen Spaces. The full task browser is a heavier normal window. Splitting them keeps the always-on agent tiny and lets the big window be launched/closed independently.

In the shipped app the user still installs **one** thing: `scripts/make-app.sh` nests the tray app _inside_ the main app bundle at `Taskscape.app/Contents/Library/LoginItems/taskscape-tray.app`, and the main app launches it on startup. See [build-and-run.md](build-and-run.md).

## How the two processes coordinate

Two mechanisms, both provided by the `common` crate:

2. **Localhost HTTP (axum)** for live signalling — "I just changed data, please refresh" or "please focus your window". Each app serves the shared `data_router` on a fixed port and calls the other via `server::client`.

```
   taskscape-main  ── HTTP :7420 ──┐        ┌── HTTP :7421 ──  taskscape-tray
        │  (serves /refresh,       │        │   (serves data_router only)
        │   /focus + data_router)  │        │
        └────────────── both read/write ────┘
                     ~/.taskscape/taskscape.db  (SQLite, WAL)
                     ~/.taskscape/attachments/  (copied files)
                     ~/.taskscape/screenshots/  (captures)
```

Ports and the endpoint set live in [common-crate.md](common-crate.md).

### Typical capture flow (tray → main)

1. User hits **⌘Return** → tray shows the mini bar at the cursor.
2. User types a title (optionally attaches a screenshot) and presses Enter.
3. Tray writes the task straight into SQLite via the shared `Store`.
4. Tray POSTs `/refresh` to main (:7420); if main is running it live-reloads, otherwise the change is already persisted and shows next time main opens.

## Tech stack

- **Backend:** Rust, Tauri v2, axum (HTTP), SeaORM (async SQLite) with Atlas-generated migrations, anyhow.
- **Frontend:** React 19, TypeScript, Vite 7, Tailwind CSS v4, Material Symbols.
- **macOS-native glue:** `objc2` (NSPanel / window levels / collection behavior) in the tray app. The mini bar is an opaque card — no `window-vibrancy`.

## Where to go next

- The interesting, macOS-specific code is in the tray → [tray-app.md](tray-app.md).
- Data model & IPC surface → [common-crate.md](common-crate.md).
