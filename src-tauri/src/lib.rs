mod handlers;
mod plugins;
use plugins::tauri_plugin_share;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_share::init())
        .invoke_handler(tauri::generate_handler![handlers::get_appdir])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
