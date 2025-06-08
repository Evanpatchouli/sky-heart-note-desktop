// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    dbg!(tauri::path::BaseDirectory::AppData);
    sky_heart_note_desktop_lib::run()
}
