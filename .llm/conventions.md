# Conventions

Patterns to match when editing. Keep new code consistent with what's here.

## Rust

- **Error mapping at the Tauri boundary.** Each `src-tauri/src/lib.rs` defines a local `fn err<E: Display>(e) -> String`. Commands return `Result<T, String>` and end fallible calls with `.map_err(err)`. Keep that shape for new commands.
- **`anyhow` inside `common`.** Library code returns `anyhow::Result<T>`; the HTTP layer wraps any error via `AppError` → 500. Use `.with_context(...)` for file/IO operations (see `attachments::attach_copy`).
- **One `Store` per process**, shared as Tauri managed state (`.manage(store)` → `State<'_, Arc<Store>>`). Don't open extra connections.
- **macOS-only code is `#[cfg(target_os = "macos")]`**; provide a non-macOS fallback that `bail!`s where it makes sense (see `screenshot.rs`).
- Timestamps: `util::now_millis()` (unix millis). IDs: `util::new_id()` (UUIDv4).

## Frontend (React + TS)

- **All IPC goes through `src/api.ts`.** One typed wrapper per Tauri command: `foo: (args) => invoke<Ret>("foo", { ... })`. Components never call `invoke` directly — add to `api.ts` and import `api`.
- **Rust `snake_case` args ⇄ camelCase call sites.** Tauri converts automatically; `api.ts` is where the two naming worlds meet (e.g. `screenshotPath` → `screenshot_path`).
- **Tailwind v4 utility classes**, no component library. The design language is small, rounded, and **opaque**, built from each app's semantic role-tokens (`bg-surface-*`, `border-edge-*`, `text-content-*`, `rounded-panel`/`rounded-control`) defined in `index.css` — not raw palette colors.
- **Icons:** the shared `Icon` component (Material Symbols, self-hosted for offline use). Pass `name`, `size`, `filled`.
- **Cross-process events:** the frontend `listen(...)`s for events the Rust side `emit`s — tray listens for `mini-shown`; main listens for `refresh`. Clean up the listener in the `useEffect` return.

## Comments & style

- **Minimal comments.** Don't restate what the code says. Do explain non-obvious _why_ — the codebase's best examples are the macOS window-mechanics comments in the tray's `lib.rs` (why an NSPanel, why parking off-screen, why the reveal grace). Match that bar: comment intent and platform quirks, not mechanics.
- Prefer small free functions with a one-line doc comment over inline blocks.

## Adding a feature that spans both sides — checklist

1. `common` — add/extend `Store` methods and/or models if data shape changes.
2. Rust command in the relevant app's `lib.rs`; register it in `invoke_handler![...]`.
3. `src/api.ts` — add the typed wrapper.
4. Component — call `api.*`, handle the result.
5. If the _other_ app must react live, POST to its HTTP endpoint (add a route if needed) rather than polling.
