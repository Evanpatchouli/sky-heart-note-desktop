use std::env;

#[tauri::command]
pub fn get_appdir() -> String {
    // app_dir().expect("Failed to get app directory").to_string_lossy().into_owned()
    env::current_dir()
        .expect("Failed to get app directory")
        .to_string_lossy()
        .into_owned()
}
