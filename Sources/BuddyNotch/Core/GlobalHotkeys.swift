import AppKit
import Carbon

final class GlobalHotkeys {
    private var globalMonitor: Any?
    private var localMonitor: Any?
    private weak var sessionManager: SessionManager?
    private weak var soundEngine: SoundEngine?

    init(sessionManager: SessionManager, soundEngine: SoundEngine) {
        self.sessionManager = sessionManager
        self.soundEngine = soundEngine
    }

    func start() {
        // Check accessibility permission
        let key = "AXTrustedCheckOptionPrompt" as CFString
        let trusted = AXIsProcessTrustedWithOptions(
            [key: true] as CFDictionary
        )
        if !trusted {
            print("[GlobalHotkeys] Accessibility permission not granted — hotkeys will not work until enabled")
        }

        // Global: catches keys when app is NOT focused
        globalMonitor = NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] event in
            DispatchQueue.main.async {
                self?.handleKeyEvent(event)
            }
        }

        // Local: catches keys when app IS focused
        localMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            DispatchQueue.main.async {
                self?.handleKeyEvent(event)
            }
            return event
        }
    }

    func stop() {
        if let m = globalMonitor { NSEvent.removeMonitor(m) }
        if let m = localMonitor { NSEvent.removeMonitor(m) }
        globalMonitor = nil
        localMonitor = nil
    }

    private func handleKeyEvent(_ event: NSEvent) {
        guard event.modifierFlags.contains(.command) else { return }
        guard let sm = sessionManager else { return }

        switch sm.currentPanelState {
        case .approval(let sessionId):
            if event.keyCode == UInt16(kVK_ANSI_Y) {
                sm.approveSession(sessionId)
                soundEngine?.playApproval()
            } else if event.keyCode == UInt16(kVK_ANSI_N) {
                sm.denySession(sessionId)
                soundEngine?.playDeny()
            }

        case .ask(let sessionId):
            let numberKeys: [UInt16: Int] = [
                UInt16(kVK_ANSI_1): 0,
                UInt16(kVK_ANSI_2): 1,
                UInt16(kVK_ANSI_3): 2,
            ]
            if let index = numberKeys[event.keyCode] {
                sm.answerSession(sessionId, optionIndex: index)
            }

        default:
            break
        }
    }
}
