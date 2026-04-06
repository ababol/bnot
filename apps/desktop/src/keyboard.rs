use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation, EventField};
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

/// Virtual key codes (Carbon kVK_* constants)
const KVK_ANSI_1: u16 = 0x12;
const KVK_ANSI_2: u16 = 0x13;
const KVK_ANSI_3: u16 = 0x14;
const KVK_ANSI_4: u16 = 0x15;
const KVK_ANSI_5: u16 = 0x17;
const KVK_ANSI_6: u16 = 0x16;
const KVK_ANSI_7: u16 = 0x1A;
const KVK_ANSI_8: u16 = 0x1C;
const KVK_ANSI_9: u16 = 0x19;
const KVK_ANSI_LEFT_BRACKET: u16 = 0x21;
const KVK_ANSI_RIGHT_BRACKET: u16 = 0x1E;

const TAB_KEYS: [u16; 9] = [
    KVK_ANSI_1,
    KVK_ANSI_2,
    KVK_ANSI_3,
    KVK_ANSI_4,
    KVK_ANSI_5,
    KVK_ANSI_6,
    KVK_ANSI_7,
    KVK_ANSI_8,
    KVK_ANSI_9,
];

fn send_key(key_code: u16, flags: CGEventFlags) {
    let source = match CGEventSource::new(CGEventSourceStateID::HIDSystemState) {
        Ok(s) => s,
        Err(_) => return,
    };

    if let Ok(down) = CGEvent::new_keyboard_event(source.clone(), key_code, true) {
        down.set_flags(flags);
        down.post(CGEventTapLocation::HID);
    }
    if let Ok(up) = CGEvent::new_keyboard_event(source, key_code, false) {
        up.set_flags(flags);
        up.post(CGEventTapLocation::HID);
    }
}

/// Send Cmd+N to switch to tab N (1-9)
pub fn send_goto_tab(tab: u16) {
    if tab < 1 || tab > 9 {
        return;
    }
    send_key(TAB_KEYS[(tab - 1) as usize], CGEventFlags::CGEventFlagCommand);
}

/// Navigate panes: reset to first (Cmd+[ x reset_count), then forward (Cmd+] x forward_count)
pub fn navigate_pane(reset_count: u16, forward_count: u16) {
    for _ in 0..reset_count {
        send_key(KVK_ANSI_LEFT_BRACKET, CGEventFlags::CGEventFlagCommand);
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    for _ in 0..forward_count {
        send_key(KVK_ANSI_RIGHT_BRACKET, CGEventFlags::CGEventFlagCommand);
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
}

/// Activate an app by bundle ID, returns true if found
pub fn activate_app(bundle_id: &str) -> bool {
    use objc2_foundation::NSString;

    unsafe {
        let ns_bundle_id = NSString::from_str(bundle_id);
        // Use msg_send to avoid NSArray generics issues
        let apps: objc2::rc::Retained<objc2::runtime::AnyObject> = objc2::msg_send_id![
            objc2::class!(NSRunningApplication),
            runningApplicationsWithBundleIdentifier: &*ns_bundle_id
        ];
        let count: usize = objc2::msg_send![&apps, count];
        if count > 0 {
            let app: objc2::rc::Retained<objc2::runtime::AnyObject> =
                objc2::msg_send_id![&apps, objectAtIndex: 0usize];
            let _: bool = objc2::msg_send![&app, activateWithOptions: 0x01u64];
            return true;
        }
    }
    false
}
