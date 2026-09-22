use std::net::SocketAddr;
use std::sync::Arc;

use anyhow::Context;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{Html, Redirect};
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use chrono::{Datelike, Local, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{postgres::PgPoolOptions, FromRow, PgPool};
use tower_http::cors::{Any, CorsLayer};
use tracing::{info, warn};

#[derive(Clone)]
struct AppState {
    pool: Arc<PgPool>,
    qweather_api_host: String,
    qweather_key: String,
    qweather_location: String,
}

#[derive(Debug, Serialize, FromRow)]
struct Todo {
    id: i64,
    title: String,
    urgent: bool,
    important: bool,
    done: bool,
    updated_at: chrono::DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
struct ListQuery {
    device_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DoneRequest {
    device_id: String,
}

#[derive(Debug, Deserialize)]
struct CreateTodoRequest {
    title: String,
    urgent: bool,
    important: bool,
}

#[derive(Debug, Deserialize)]
struct UpdateTodoRequest {
    title: Option<String>,
    urgent: Option<bool>,
    important: Option<bool>,
    done: Option<bool>,
}

#[derive(Debug, Serialize)]
struct TodoListResponse {
    todos: Vec<Todo>,
    server_time: String,
}

#[derive(Debug, Serialize)]
struct DashboardResponse {
    calendar: CalendarInfo,
    weather_now: WeatherNow,
    weather_24h: Vec<Weather24hItem>,
    weather_14d: Vec<Weather14dItem>,
    home_cards: Vec<String>,
    todo_summary: TodoSummary,
    todo_preview: Vec<TodoPreviewItem>,
    todos: Vec<Todo>,
    server_time: String,
}

#[derive(Debug, Serialize)]
struct CalendarInfo {
    date: String,
    time: String,
    weekday: String,
    lunar: String,
}

#[derive(Debug, Serialize)]
struct WeatherNow {
    temp: i32,
    text: String,
    feels_like: i32,
    humidity: i32,
    wind: String,
}

#[derive(Debug, Serialize, Clone)]
struct Weather24hItem {
    hour: String,
    temp: i32,
    text: String,
    icon: String,
    wind_dir: String,
    wind_scale: String,
}

#[derive(Debug, Serialize, Clone)]
struct Weather14dItem {
    date: String,
    text: String,
    high: i32,
    low: i32,
    icon: String,
    wind_scale: String,
}

#[derive(Debug, Serialize)]
struct TodoSummary {
    total: usize,
    pending: usize,
    q1: usize,
    q2: usize,
    q3: usize,
    q4: usize,
}

#[derive(Debug, Serialize)]
struct TodoPreviewItem {
    title: String,
}

#[derive(Debug, Deserialize)]
struct QWeather24hResponse {
    code: String,
    hourly: Option<Vec<QWeather24hItem>>,
}

#[derive(Debug, Deserialize)]
struct QWeather24hItem {
    #[serde(rename = "fxTime")]
    fx_time: Option<String>,
    temp: Option<String>,
    text: Option<String>,
    icon: Option<String>,
    #[serde(rename = "windDir")]
    wind_dir: Option<String>,
    #[serde(rename = "windScale")]
    wind_scale: Option<String>,
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: &'static str,
    time: String,
}

#[derive(Debug, Serialize)]
struct ErrorResponse {
    error: String,
}

const ADMIN_PAGE_HTML: &str = include_str!("admin_page.html");

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "k_todo_server=info,tower_http=info".to_string()),
        )
        .init();

    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@127.0.0.1:5432/k_todo".to_string());
    let bind_addr = std::env::var("BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:8080".to_string());
    let qweather_api_host = std::env::var("QWEATHER_API_HOST")
        .unwrap_or_else(|_| "devapi.qweather.com".to_string());
    let qweather_key = std::env::var("QWEATHER_KEY").unwrap_or_default();
    let qweather_location = std::env::var("QWEATHER_LOCATION").unwrap_or_default();

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await
        .with_context(|| format!("failed to connect database: {}", database_url))?;

    init_db(&pool).await?;

    let state = AppState {
        pool: Arc::new(pool),
        qweather_api_host,
        qweather_key,
        qweather_location,
    };

    let app = Router::new()
        .route("/", get(root_redirect))
        .route("/admin", get(admin_page))
        .route("/health", get(health))
        .route("/api/v1/dashboard", get(get_dashboard))
        .route("/api/v1/todos", get(list_todos).post(create_todo))
        .route("/api/v1/todos/:id", patch(update_todo).delete(delete_todo))
        .route("/api/v1/todos/:id/done", post(mark_done))
        .with_state(state)
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        );

    let addr: SocketAddr = bind_addr.parse().context("invalid BIND_ADDR")?;
    info!("k-todo server listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

async fn init_db(pool: &PgPool) -> anyhow::Result<()> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS todos (
            id BIGSERIAL PRIMARY KEY,
            title TEXT NOT NULL,
            urgent BOOLEAN NOT NULL DEFAULT FALSE,
            important BOOLEAN NOT NULL DEFAULT FALSE,
            done BOOLEAN NOT NULL DEFAULT FALSE,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )",
    )
    .execute(pool)
    .await?;

    let (count,): (i64,) = sqlx::query_as("SELECT COUNT(1) as count FROM todos")
        .fetch_one(pool)
        .await?;

    if count == 0 {
        sqlx::query(
            "INSERT INTO todos (title, urgent, important, done) VALUES
            ('补货墨水屏保护膜', TRUE, TRUE, FALSE),
            ('阅读 Rust 文档', FALSE, TRUE, FALSE),
            ('回复非紧急邮件', TRUE, FALSE, FALSE),
            ('整理桌面', FALSE, FALSE, FALSE)",
        )
        .execute(pool)
        .await?;
    }

    Ok(())
}

async fn root_redirect() -> Redirect {
    Redirect::to("/admin")
}

async fn admin_page() -> Html<&'static str> {
    Html(ADMIN_PAGE_HTML)
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        time: Utc::now().to_rfc3339(),
    })
}

async fn get_dashboard(
    State(state): State<AppState>,
    Query(query): Query<ListQuery>,
) -> Result<Json<DashboardResponse>, (StatusCode, Json<ErrorResponse>)> {
    if let Some(device_id) = query.device_id {
        info!("get_dashboard from device: {}", device_id);
    }

    let todos = sqlx::query_as::<_, Todo>(
        "SELECT id, title, urgent, important, done, updated_at
         FROM todos
         ORDER BY important DESC, urgent DESC, id ASC",
    )
    .fetch_all(&*state.pool)
    .await
    .map_err(internal_error)?;

    let (todo_summary, todo_preview) = build_todo_summary(&todos);

    let local_now = Local::now();
    let calendar = CalendarInfo {
        date: local_now.format("%Y-%m-%d").to_string(),
        time: local_now.format("%H:%M").to_string(),
        weekday: weekday_zh(local_now.weekday().num_days_from_sunday()),
        lunar: "农历待接入".to_string(),
    };

    let weather_24h = match fetch_qweather_24h(
        &state.qweather_api_host,
        &state.qweather_key,
        &state.qweather_location,
    )
    .await
    {
        Ok(items) if !items.is_empty() => items,
        Ok(_) => {
            warn!("qweather returned empty hourly list, fallback to mock");
            default_weather_24h()
        }
        Err(err) => {
            warn!("qweather fetch failed: {}", err);
            default_weather_24h()
        }
    };

    let weather_now = build_weather_now(&weather_24h);
    let weather_14d = default_weather_14d();

    Ok(Json(DashboardResponse {
        calendar,
        weather_now,
        weather_24h,
        weather_14d,
        home_cards: vec![
            "晚上20:00 倒垃圾".to_string(),
            "周三 物业缴费".to_string(),
            "周末 补货生活用品".to_string(),
        ],
        todo_summary,
        todo_preview,
        todos,
        server_time: Utc::now().to_rfc3339(),
    }))
}

fn weekday_zh(day_from_sunday: u32) -> String {
    let names = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
    names[(day_from_sunday as usize).min(6)].to_string()
}

fn parse_temp(v: Option<&str>, default: i32) -> i32 {
    v.and_then(|s| s.parse::<i32>().ok()).unwrap_or(default)
}

fn hour_text_from_fx_time(fx_time: Option<&str>, fallback_idx: usize) -> String {
    if let Some(raw) = fx_time {
        if let Some(time_part) = raw.split('T').nth(1) {
            return time_part.chars().take(5).collect::<String>();
        }
        if raw.len() >= 5 {
            return raw.chars().take(5).collect::<String>();
        }
    }
    format!("{:02}:00", fallback_idx % 24)
}

async fn fetch_qweather_24h(
    api_host: &str,
    key: &str,
    location: &str,
) -> anyhow::Result<Vec<Weather24hItem>> {
    if key.trim().is_empty() || location.trim().is_empty() {
        return Err(anyhow::anyhow!(
            "missing QWEATHER_KEY or QWEATHER_LOCATION in environment"
        ));
    }

    let api_host = normalize_qweather_api_host(api_host);
    let url = format!("https://{}/v7/weather/24h", api_host);

    let resp = reqwest::Client::new()
        .get(url)
        .header("X-QW-Api-Key", key)
        .query(&[("location", location)])
        .send()
        .await
        .context("request qweather 24h failed")?
        .error_for_status()
        .context("qweather http status not success")?
        .json::<QWeather24hResponse>()
        .await
        .context("parse qweather response failed")?;

    if resp.code != "200" {
        return Err(anyhow::anyhow!("qweather code={} (expect 200)", resp.code));
    }

    let hourly = resp.hourly.unwrap_or_default();
    let mut result = Vec::new();

    for (idx, h) in hourly.into_iter().take(24).enumerate() {
        result.push(Weather24hItem {
            hour: hour_text_from_fx_time(h.fx_time.as_deref(), idx),
            temp: parse_temp(h.temp.as_deref(), 0),
            text: h.text.unwrap_or_else(|| "--".to_string()),
            icon: h.icon.unwrap_or_else(|| "--".to_string()),
            wind_dir: h.wind_dir.unwrap_or_else(|| "--".to_string()),
            wind_scale: h.wind_scale.unwrap_or_else(|| "--".to_string()),
        });
    }

    Ok(result)
}

fn normalize_qweather_api_host(host: &str) -> String {
    let trimmed = host.trim();
    if trimmed.is_empty() {
        return "devapi.qweather.com".to_string();
    }

    let no_schema = trimmed
        .strip_prefix("https://")
        .or_else(|| trimmed.strip_prefix("http://"))
        .unwrap_or(trimmed);

    no_schema.trim_end_matches('/').to_string()
}

fn build_weather_now(weather_24h: &[Weather24hItem]) -> WeatherNow {
    if let Some(first) = weather_24h.first() {
        WeatherNow {
            temp: first.temp,
            text: first.text.clone(),
            feels_like: first.temp,
            humidity: 60,
            wind: format!("{}{}级", first.wind_dir, first.wind_scale),
        }
    } else {
        WeatherNow {
            temp: 26,
            text: "多云".to_string(),
            feels_like: 27,
            humidity: 65,
            wind: "东风2级".to_string(),
        }
    }
}

fn default_weather_24h() -> Vec<Weather24hItem> {
    vec![
        Weather24hItem {
            hour: "09:00".to_string(),
            temp: 26,
            text: "多云".to_string(),
            icon: "101".to_string(),
            wind_dir: "东北风".to_string(),
            wind_scale: "2".to_string(),
        },
        Weather24hItem {
            hour: "12:00".to_string(),
            temp: 28,
            text: "晴".to_string(),
            icon: "100".to_string(),
            wind_dir: "东风".to_string(),
            wind_scale: "3".to_string(),
        },
        Weather24hItem {
            hour: "15:00".to_string(),
            temp: 29,
            text: "晴".to_string(),
            icon: "100".to_string(),
            wind_dir: "东南风".to_string(),
            wind_scale: "3".to_string(),
        },
        Weather24hItem {
            hour: "18:00".to_string(),
            temp: 27,
            text: "多云".to_string(),
            icon: "101".to_string(),
            wind_dir: "南风".to_string(),
            wind_scale: "2".to_string(),
        },
        Weather24hItem {
            hour: "21:00".to_string(),
            temp: 24,
            text: "小雨".to_string(),
            icon: "305".to_string(),
            wind_dir: "西南风".to_string(),
            wind_scale: "2".to_string(),
        },
        Weather24hItem {
            hour: "00:00".to_string(),
            temp: 22,
            text: "小雨".to_string(),
            icon: "305".to_string(),
            wind_dir: "西风".to_string(),
            wind_scale: "2".to_string(),
        },
    ]
}

fn default_weather_14d() -> Vec<Weather14dItem> {
    let mut result = Vec::new();
    let start = Local::now().date_naive();

    for i in 0..14 {
        let d = start + chrono::Days::new(i as u64);
        result.push(Weather14dItem {
            date: d.format("%m-%d").to_string(),
            text: if i % 3 == 0 {
                "多云".to_string()
            } else if i % 3 == 1 {
                "晴".to_string()
            } else {
                "小雨".to_string()
            },
            high: 29 - (i % 4) as i32,
            low: 21 - (i % 3) as i32,
            icon: if i % 3 == 2 { "305".to_string() } else { "101".to_string() },
            wind_scale: (2 + (i % 2)).to_string(),
        });
    }

    result
}

fn build_todo_summary(todos: &[Todo]) -> (TodoSummary, Vec<TodoPreviewItem>) {
    let mut pending = 0usize;
    let mut q1 = 0usize;
    let mut q2 = 0usize;
    let mut q3 = 0usize;
    let mut q4 = 0usize;
    let mut preview = Vec::new();

    for todo in todos {
        if todo.done {
            continue;
        }

        pending += 1;
        if todo.urgent && todo.important {
            q1 += 1;
        } else if !todo.urgent && todo.important {
            q2 += 1;
        } else if todo.urgent && !todo.important {
            q3 += 1;
        } else {
            q4 += 1;
        }

        if preview.len() < 3 {
            preview.push(TodoPreviewItem {
                title: todo.title.clone(),
            });
        }
    }

    (
        TodoSummary {
            total: todos.len(),
            pending,
            q1,
            q2,
            q3,
            q4,
        },
        preview,
    )
}

async fn list_todos(
    State(state): State<AppState>,
    Query(query): Query<ListQuery>,
) -> Result<Json<TodoListResponse>, (StatusCode, Json<ErrorResponse>)> {
    if let Some(device_id) = query.device_id {
        info!("list_todos from device: {}", device_id);
    }

    let todos = sqlx::query_as::<_, Todo>(
        "SELECT id, title, urgent, important, done, updated_at
         FROM todos
         ORDER BY important DESC, urgent DESC, id ASC",
    )
    .fetch_all(&*state.pool)
    .await
    .map_err(internal_error)?;

    Ok(Json(TodoListResponse {
        todos,
        server_time: Utc::now().to_rfc3339(),
    }))
}

async fn mark_done(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(payload): Json<DoneRequest>,
) -> Result<Json<Todo>, (StatusCode, Json<ErrorResponse>)> {
    info!("mark_done id={} by device={}", id, payload.device_id);

    let result = sqlx::query(
        "UPDATE todos
         SET done = TRUE,
             updated_at = NOW()
         WHERE id = $1",
    )
    .bind(id)
    .execute(&*state.pool)
    .await
    .map_err(internal_error)?;

    if result.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "todo not found".to_string(),
            }),
        ));
    }

    let todo = sqlx::query_as::<_, Todo>(
        "SELECT id, title, urgent, important, done, updated_at
         FROM todos
            WHERE id = $1",
    )
    .bind(id)
    .fetch_one(&*state.pool)
    .await
    .map_err(internal_error)?;

    Ok(Json(todo))
}

async fn create_todo(
    State(state): State<AppState>,
    Json(payload): Json<CreateTodoRequest>,
) -> Result<(StatusCode, Json<Todo>), (StatusCode, Json<ErrorResponse>)> {
    let title = payload.title.trim();
    if title.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "title is required".to_string(),
            }),
        ));
    }

    let todo = sqlx::query_as::<_, Todo>(
        "INSERT INTO todos (title, urgent, important, done, updated_at)
         VALUES ($1, $2, $3, FALSE, NOW())
         RETURNING id, title, urgent, important, done, updated_at",
    )
    .bind(title)
    .bind(payload.urgent)
    .bind(payload.important)
    .fetch_one(&*state.pool)
    .await
    .map_err(internal_error)?;

    Ok((StatusCode::CREATED, Json(todo)))
}

async fn update_todo(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(payload): Json<UpdateTodoRequest>,
) -> Result<Json<Todo>, (StatusCode, Json<ErrorResponse>)> {
    let existing = fetch_todo_by_id(&state.pool, id).await?;

    let next_title = payload
        .title
        .map(|s| s.trim().to_string())
        .unwrap_or(existing.title);
    let next_urgent = payload.urgent.unwrap_or(existing.urgent);
    let next_important = payload.important.unwrap_or(existing.important);
    let next_done = payload.done.unwrap_or(existing.done);

    if next_title.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "title cannot be empty".to_string(),
            }),
        ));
    }

    sqlx::query(
        "UPDATE todos
            SET title = $1, urgent = $2, important = $3, done = $4, updated_at = NOW()
            WHERE id = $5",
    )
    .bind(next_title)
    .bind(next_urgent)
    .bind(next_important)
    .bind(next_done)
    .bind(id)
    .execute(&*state.pool)
    .await
    .map_err(internal_error)?;

    let todo = fetch_todo_by_id(&state.pool, id).await?;
    Ok(Json(todo))
}

async fn delete_todo(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    let result = sqlx::query("DELETE FROM todos WHERE id = $1")
        .bind(id)
        .execute(&*state.pool)
        .await
        .map_err(internal_error)?;

    if result.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "todo not found".to_string(),
            }),
        ));
    }

    Ok(StatusCode::NO_CONTENT)
}

async fn fetch_todo_by_id(
    pool: &PgPool,
    id: i64,
) -> Result<Todo, (StatusCode, Json<ErrorResponse>)> {
    sqlx::query_as::<_, Todo>(
        "SELECT id, title, urgent, important, done, updated_at
         FROM todos
         WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(internal_error)?
    .ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "todo not found".to_string(),
            }),
        )
    })
}

fn internal_error(err: sqlx::Error) -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorResponse {
            error: err.to_string(),
        }),
    )
}
