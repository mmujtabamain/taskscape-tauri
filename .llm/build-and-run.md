# Build & run

## Dev

```bash
./run-dev.sh
```

Runs **both** apps together and tears both down on Ctrl-C. Each is a normal `npm run tauri dev` (installs `node_modules` first if missing):

- `taskscape-main` → Vite on **:1420**, HTTP on **:7420**
- `taskscape-tray` → Vite on **:1421**, HTTP on **:7421**

In dev the two apps are launched by the script, so the main app's `launch_embedded_tray()` is a no-op (the nested bundle only exists in packaged builds).

To run just one app: `cd taskscape-tray && npm run tauri dev`.

## Ports (fixed)

| Port        | Used by                                                              |
| ----------- | -------------------------------------------------------------------- |
| 1420 / 1421 | Vite dev servers (main / tray). `strictPort` — dev fails if taken.   |
| 7420 / 7421 | Runtime HTTP IPC (`MAIN_PORT` / `TRAY_PORT` in `common/src/lib.rs`). |

## Package into one `.dmg`

```bash
./make-app.sh   # → dist/Taskscape.dmg
```

What it does:

1. `tauri build --bundles app` for **both** apps (release `.app` bundles).
2. **Embeds** the tray app inside the main app at `Taskscape.app/Contents/Library/LoginItems/taskscape-tray.app` — so the user installs one app and the main app launches the nested tray on startup.
3. Assembles `dist/Taskscape.dmg` (the app + an `/Applications` symlink).

Bundles are **unsigned**: first launch needs right-click → Open, or `xattr -dr com.apple.quarantine <app>` (recurses into the nested tray helper).

## Gotchas

- Changing an IPC port means editing `common/src/lib.rs` (runtime) and/or the `vite.config.ts` `server.port` (dev) — they are independent.
- The tray's window label is `"main"` — don't confuse it with the main app.
- Rust changes rebuild via Cargo on the next `tauri dev`/`build`; frontend changes hot-reload through Vite.
