//! The tray's localhost HTTP endpoint (port `TRAY_PORT`). Serves the shared data
//! router plus the tray-only routes the main app POSTs to: re-register hotkeys
//! after the settings window closes, and report the main window's focus so the
//! global combos know whether to act on it.

use axum::http::StatusCode;
use axum::routing::post;
use axum::Router;
use taskscape_common::{server, TRAY_PORT};

use crate::{ctx, hotkeys};

/// Spin up the HTTP server on the tokio runtime (fire-and-forget).
pub fn serve() {
    let store = ctx::store();
    ctx::runtime().spawn(async move {
        let app_routes = Router::new()
            .route("/reload-hotkeys", post(reload_hotkeys))
            .route("/main-focused", post(main_focused))
            .route("/main-blurred", post(main_blurred));
        let router = server::data_router(store).merge(app_routes);
        if let Err(e) = server::serve(TRAY_PORT, router).await {
            eprintln!("[taskscape-tray] HTTP server error: {e}");
        }
    });
}

/// Main POSTs here after the settings window closes: re-register the globals from
/// the (shared) settings and refresh the bar's kbd hints + tray tooltip.
async fn reload_hotkeys() -> StatusCode {
    hotkeys::refresh();
    StatusCode::OK
}

async fn main_focused() -> StatusCode {
    ctx::set_main_focused(true);
    StatusCode::OK
}

async fn main_blurred() -> StatusCode {
    ctx::set_main_focused(false);
    StatusCode::OK
}
