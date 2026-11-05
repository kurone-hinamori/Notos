use std::{fs, path::PathBuf};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

fn stories_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("stories");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn story_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("invalid story id".into());
    }
    Ok(stories_dir(app)?.join(format!("{id}.json")))
}

fn body_chars(story: &Value) -> usize {
    story["chapters"]
        .as_array()
        .map(|cs| {
            cs.iter()
                .map(|c| c["body"].as_str().unwrap_or("").chars().count())
                .sum()
        })
        .unwrap_or(0)
}

/// 一覧表示用の概要。短編集(kind = "anthology")は各話を集計する。
fn summarize(story: &Value) -> Value {
    if story["kind"].as_str() == Some("anthology") {
        let episodes: Vec<&Value> = story["episodes"]
            .as_array()
            .map(|e| e.iter().collect())
            .unwrap_or_default();
        let titles: Vec<&str> = episodes
            .iter()
            .filter_map(|e| e["title"].as_str())
            .filter(|t| !t.trim().is_empty())
            .collect();
        let done = episodes
            .iter()
            .filter(|e| e["status"].as_str() == Some("done"))
            .count();
        return json!({
            "kind": "anthology",
            "format": story["format"].as_str().unwrap_or("anthology"),
            "id": story["id"],
            "title": story["title"],
            "tagline": "",
            "synopsis": titles.join(" / "),
            "keywords": story["keywords"],
            "status": if done > 0 && done == episodes.len() { "done" } else if titles.is_empty() { "concept" } else { "producing" },
            "createdAt": story["createdAt"],
            "updatedAt": story["updatedAt"],
            "chapterCount": episodes.len(),
            "doneCount": done,
            "charCount": episodes.iter().map(|e| body_chars(e)).sum::<usize>(),
        });
    }
    json!({
        "kind": "novel",
        "id": story["id"],
        "title": story["title"],
        "tagline": story["tagline"],
        "synopsis": story["synopsis"],
        "keywords": story["keywords"],
        "status": story["status"],
        "createdAt": story["createdAt"],
        "updatedAt": story["updatedAt"],
        "chapterCount": story["chapters"].as_array().map(|c| c.len()).unwrap_or(0),
        "doneCount": 0,
        "charCount": body_chars(story),
    })
}

/// 物語の概要一覧(本文を含まない軽量版)を更新日時の新しい順で返す。
#[tauri::command]
fn list_stories(app: AppHandle) -> Result<Vec<Value>, String> {
    let dir = stories_dir(&app)?;
    let mut items: Vec<Value> = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Ok(text) = fs::read_to_string(&path) else { continue };
        let Ok(story) = serde_json::from_str::<Value>(&text) else { continue };
        items.push(summarize(&story));
    }
    items.sort_by(|a, b| {
        b["updatedAt"]
            .as_str()
            .unwrap_or("")
            .cmp(a["updatedAt"].as_str().unwrap_or(""))
    });
    Ok(items)
}

#[tauri::command]
fn load_story(app: AppHandle, id: String) -> Result<Value, String> {
    let text = fs::read_to_string(story_path(&app, &id)?).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

/// 一時ファイルに書いてからリネームし、書き込み途中の破損を避ける。
#[tauri::command]
fn save_story(app: AppHandle, story: Value) -> Result<(), String> {
    let id = story["id"].as_str().ok_or("missing story id")?.to_string();
    let path = story_path(&app, &id)?;
    let tmp = path.with_extension("json.tmp");
    let text = serde_json::to_string(&story).map_err(|e| e.to_string())?;
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_story(app: AppHandle, id: String) -> Result<(), String> {
    let path = story_path(&app, &id)?;
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    let art = art_dir(&app, &id)?;
    if art.exists() {
        fs::remove_dir_all(art).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 物語ごとの画像の置き場所。本文の JSON が大きくならないよう、画像は別のファイルにする。
fn art_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("invalid story id".into());
    }
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("art")
        .join(id))
}

fn art_path(app: &AppHandle, id: &str, file: &str) -> Result<PathBuf, String> {
    if !valid_id(file) {
        return Err("invalid art id".into());
    }
    Ok(art_dir(app, id)?.join(format!("{file}.png")))
}

/// 画像の中身をそのまま受け取る(id と file はヘッダーで渡す)。
#[tauri::command]
fn save_art(app: AppHandle, request: tauri::ipc::Request) -> Result<(), String> {
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string)
            .ok_or_else(|| format!("missing {name}"))
    };
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("image bytes expected".into());
    };
    let path = art_path(&app, &header("story")?, &header("file")?)?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(path, bytes).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_art(app: AppHandle, id: String, file: String) -> Result<tauri::ipc::Response, String> {
    let bytes = fs::read(art_path(&app, &id, &file)?).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
fn delete_art(app: AppHandle, id: String, file: String) -> Result<(), String> {
    let path = art_path(&app, &id, &file)?;
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_process::init());

    // ウィンドウの位置とサイズは、終了時に保存して次回の起動時に復元する
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build());

    builder
        .invoke_handler(tauri::generate_handler![
            list_stories,
            load_story,
            save_story,
            delete_story,
            save_art,
            load_art,
            delete_art
        ])
        .run(tauri::generate_context!())
        .expect("error while running Notos");
}
