//! Shared HTTP endpoints for cross-process IPC.
//!
//! Both apps mount [`data_router`] on their own localhost port (see
//! [`crate::MAIN_PORT`] / [`crate::TRAY_PORT`]) and can call each other through
//! the [`client`] helpers. All data endpoints are backed by the shared
//! [`Store`], so a request handled by either process reads and writes the same
//! `~/.taskscape/taskscape.db`.

use std::net::SocketAddr;
use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, patch, post},
    Json, Router,
};
use serde::Deserialize;

use crate::models::{Attachment, List, Task};
use crate::storage::Store;

/// Build the router exposing the shared data endpoints, backed by `store`.
///
/// Apps can `.merge()` their own app-specific routes onto the returned router
/// before serving it.
pub fn data_router(store: Arc<Store>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/lists", get(get_lists).post(create_list))
        .route("/lists/{id}/tasks", get(get_list_tasks))
        .route("/tasks", get(get_tasks).post(create_task))
        .route("/tasks/{id}", patch(update_task).delete(delete_task))
        .route(
            "/tasks/{id}/attachments",
            get(get_attachments).post(add_reference),
        )
        .route("/tasks/{id}/attachments/copy", post(add_copy))
        .with_state(store)
}

/// Bind `127.0.0.1:port` and serve `router` until the process exits.
pub async fn serve(port: u16, router: Router) -> anyhow::Result<()> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, router).await?;
    Ok(())
}

// ---- handlers ------------------------------------------------------------

type ApiResult<T> = Result<Json<T>, AppError>;

async fn health() -> &'static str {
    "ok"
}

async fn get_lists(State(store): State<Arc<Store>>) -> ApiResult<Vec<List>> {
    Ok(Json(store.list_lists()?))
}

async fn create_list(
    State(store): State<Arc<Store>>,
    Json(body): Json<CreateList>,
) -> ApiResult<List> {
    Ok(Json(store.create_list(&body.name)?))
}

async fn get_list_tasks(
    State(store): State<Arc<Store>>,
    Path(id): Path<String>,
) -> ApiResult<Vec<Task>> {
    Ok(Json(store.list_tasks(&id)?))
}

async fn get_tasks(State(store): State<Arc<Store>>) -> ApiResult<Vec<Task>> {
    Ok(Json(store.all_tasks()?))
}

async fn create_task(
    State(store): State<Arc<Store>>,
    Json(body): Json<CreateTask>,
) -> ApiResult<Task> {
    Ok(Json(store.create_task(
        &body.list_id,
        &body.title,
        body.notes.as_deref(),
    )?))
}

async fn update_task(
    State(store): State<Arc<Store>>,
    Path(id): Path<String>,
    Json(body): Json<UpdateTask>,
) -> ApiResult<Task> {
    Ok(Json(store.update_task(
        &id,
        body.title.as_deref(),
        body.notes.as_deref(),
        body.done,
    )?))
}

async fn delete_task(
    State(store): State<Arc<Store>>,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    store.delete_task(&id)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_attachments(
    State(store): State<Arc<Store>>,
    Path(id): Path<String>,
) -> ApiResult<Vec<Attachment>> {
    Ok(Json(store.list_attachments(&id)?))
}

async fn add_reference(
    State(store): State<Arc<Store>>,
    Path(id): Path<String>,
    Json(body): Json<CreateReference>,
) -> ApiResult<Attachment> {
    Ok(Json(crate::attachments::attach_reference(
        &store,
        &id,
        &body.name,
        &body.location,
    )?))
}

async fn add_copy(
    State(store): State<Arc<Store>>,
    Path(id): Path<String>,
    Json(body): Json<CreateCopy>,
) -> ApiResult<Attachment> {
    Ok(Json(crate::attachments::attach_copy(
        &store,
        &id,
        &body.source_path,
        body.name.as_deref(),
    )?))
}

// ---- request bodies ------------------------------------------------------

#[derive(Deserialize)]
pub struct CreateList {
    pub name: String,
}

#[derive(Deserialize)]
pub struct CreateTask {
    pub list_id: String,
    pub title: String,
    #[serde(default)]
    pub notes: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateTask {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub done: Option<bool>,
}

#[derive(Deserialize)]
pub struct CreateReference {
    pub name: String,
    pub location: String,
}

#[derive(Deserialize)]
pub struct CreateCopy {
    #[serde(default)]
    pub name: Option<String>,
    pub source_path: String,
}

// ---- error handling ------------------------------------------------------

/// Wraps any error so handlers can use `?` and return a 500 with the message.
pub struct AppError(anyhow::Error);

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        (StatusCode::INTERNAL_SERVER_ERROR, self.0.to_string()).into_response()
    }
}

impl<E> From<E> for AppError
where
    E: Into<anyhow::Error>,
{
    fn from(err: E) -> Self {
        Self(err.into())
    }
}

// ---- client --------------------------------------------------------------

/// Helpers for one app to call the other over HTTP.
pub mod client {
    use serde::Serialize;

    fn base(port: u16) -> String {
        format!("http://127.0.0.1:{port}")
    }

    /// Returns true if an app is listening (and healthy) on `port`.
    pub async fn is_up(port: u16) -> bool {
        reqwest::get(format!("{}/health", base(port)))
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false)
    }

    /// POST a JSON body to `path` on the app listening on `port`.
    pub async fn post_json<T: Serialize + ?Sized>(
        port: u16,
        path: &str,
        body: &T,
    ) -> anyhow::Result<()> {
        reqwest::Client::new()
            .post(format!("{}{}", base(port), path))
            .json(body)
            .send()
            .await?
            .error_for_status()?;
        Ok(())
    }
}
