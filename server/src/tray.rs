use tao::event_loop::{ControlFlow, EventLoop};
use tray_icon::{
    menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu},
    Icon, TrayIconBuilder,
};
use std::sync::{Arc, atomic::{AtomicBool, Ordering}};
use tokio::sync::mpsc;

pub enum TrayCommand {
    StartServer,
    StopServer,
    ChangePort(u16),
    Quit,
}

fn create_icon() -> Icon {
    let size = 32u32;
    let mut rgba = vec![0u8; (size * size * 4) as usize];
    for y in 0..size {
        for x in 0..size {
            let i = ((y * size + x) * 4) as usize;
            let cx = (x as f32 - 15.5).abs();
            let cy = (y as f32 - 15.5).abs();
            let in_rect = cx < 14.0 && cy < 14.0;
            if in_rect {
                rgba[i] = 0x12; rgba[i+1] = 0x13; rgba[i+2] = 0x1a; rgba[i+3] = 0xff;
                let is_chevron = (y >= 12 && y <= 22)
                    && ((x >= 6 && x <= 8 && y >= 12 && y <= 14)
                        || (x >= 8 && x <= 10 && y >= 14 && y <= 16)
                        || (x >= 10 && x <= 12 && y >= 16 && y <= 18)
                        || (x >= 8 && x <= 10 && y >= 18 && y <= 20)
                        || (x >= 6 && x <= 8 && y >= 20 && y <= 22));
                let is_underscore = y >= 20 && y <= 22 && x >= 14 && x <= 22;
                if is_chevron || is_underscore {
                    rgba[i] = 0x4a; rgba[i+1] = 0x9e; rgba[i+2] = 0xff; rgba[i+3] = 0xff;
                }
            }
        }
    }
    Icon::from_rgba(rgba, size, size).expect("Failed to create icon")
}

pub fn run_tray(cmd_tx: mpsc::UnboundedSender<TrayCommand>, running: Arc<AtomicBool>, initial_port: u16) {
    let event_loop = EventLoop::new();

    let menu = Menu::new();
    let item_status = MenuItem::new(format!("● ポート {} で起動中", initial_port), false, None);
    let item_start = MenuItem::new("サーバー開始", false, None);
    let item_stop = MenuItem::new("サーバー停止", true, None);

    let port_menu = Submenu::new("ポート変更", true);
    let port_3001 = MenuItem::new("3001", true, None);
    let port_3002 = MenuItem::new("3002", true, None);
    let port_8080 = MenuItem::new("8080", true, None);
    port_menu.append(&port_3001).ok();
    port_menu.append(&port_3002).ok();
    port_menu.append(&port_8080).ok();

    let item_quit = MenuItem::new("終了", true, None);

    menu.append(&item_status).ok();
    menu.append(&PredefinedMenuItem::separator()).ok();
    menu.append(&item_start).ok();
    menu.append(&item_stop).ok();
    menu.append(&PredefinedMenuItem::separator()).ok();
    menu.append(&port_menu).ok();
    menu.append(&PredefinedMenuItem::separator()).ok();
    menu.append(&item_quit).ok();

    let _tray = TrayIconBuilder::new()
        .with_tooltip("SSH Terminal Proxy")
        .with_icon(create_icon())
        .with_menu(Box::new(menu))
        .build()
        .expect("Failed to create tray icon");

    let menu_channel = MenuEvent::receiver();
    let start_id = item_start.id().clone();
    let stop_id = item_stop.id().clone();
    let quit_id = item_quit.id().clone();
    let p3001_id = port_3001.id().clone();
    let p3002_id = port_3002.id().clone();
    let p8080_id = port_8080.id().clone();

    event_loop.run(move |_event, _, control_flow| {
        *control_flow = ControlFlow::WaitUntil(
            std::time::Instant::now() + std::time::Duration::from_millis(100),
        );

        if let Ok(event) = menu_channel.try_recv() {
            let id = &event.id;
            if *id == start_id {
                cmd_tx.send(TrayCommand::StartServer).ok();
                item_start.set_enabled(false);
                item_stop.set_enabled(true);
                running.store(true, Ordering::SeqCst);
                item_status.set_text("● サーバー起動中...");
            } else if *id == stop_id {
                cmd_tx.send(TrayCommand::StopServer).ok();
                item_start.set_enabled(true);
                item_stop.set_enabled(false);
                running.store(false, Ordering::SeqCst);
                item_status.set_text("○ 停止中");
            } else if *id == quit_id {
                cmd_tx.send(TrayCommand::Quit).ok();
                *control_flow = ControlFlow::Exit;
            } else if *id == p3001_id {
                cmd_tx.send(TrayCommand::ChangePort(3001)).ok();
                item_status.set_text("● ポート 3001 で再起動中...");
            } else if *id == p3002_id {
                cmd_tx.send(TrayCommand::ChangePort(3002)).ok();
                item_status.set_text("● ポート 3002 で再起動中...");
            } else if *id == p8080_id {
                cmd_tx.send(TrayCommand::ChangePort(8080)).ok();
                item_status.set_text("● ポート 8080 で再起動中...");
            }
        }
    });
}
