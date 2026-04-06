import AppKit
import SwiftUI
import BuddyNotchShared

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var panel: NotchPanel!
    private var statusItem: NSStatusItem!
    private var sessionManager: SessionManager!
    private var socketServer: SocketServer!
    private var hookInstaller: HookInstaller!
    private var soundEngine: SoundEngine!
    private var globalHotkeys: GlobalHotkeys!
    private var processScanner: ProcessScanner!
    private var contextScanner: ContextScanner!
    private var lastPanelState: PanelState = .compact

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Hide from Dock
        NSApp.setActivationPolicy(.accessory)

        // Create session manager
        sessionManager = SessionManager()

        // Create and start socket server
        socketServer = SocketServer { [weak self] message, clientFd in
            DispatchQueue.main.async {
                self?.sessionManager.handleMessage(message, clientFd: clientFd)
            }
        }
        sessionManager.socketServer = socketServer
        do {
            try socketServer.start()
        } catch {
            print("Failed to start socket server: \(error)")
        }

        // Write PID file
        let pidPath = BuddyConstants.runtimeDirectory.appendingPathComponent("buddy.pid")
        try? "\(ProcessInfo.processInfo.processIdentifier)".write(to: pidPath, atomically: true, encoding: .utf8)

        // Create the notch panel
        panel = NotchPanel()
        let rootView = NotchContentView(sessionManager: sessionManager, panelRef: panel)
        let hostingView = NSHostingView(rootView: rootView)
        hostingView.frame = panel.contentView!.bounds
        hostingView.autoresizingMask = [.width, .height]
        panel.contentView?.addSubview(hostingView)
        panel.orderFrontRegardless()

        // Status bar item
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = statusItem.button {
            button.image = NSImage(systemSymbolName: "sparkles", accessibilityDescription: "BuddyNotch")
            button.action = #selector(statusBarClicked)
            button.target = self
        }

        // Setup menu for status bar
        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Show/Hide Panel", action: #selector(statusBarClicked), keyEquivalent: ""))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Install Hooks", action: #selector(installHooks), keyEquivalent: ""))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Quit BuddyNotch", action: #selector(quitApp), keyEquivalent: "q"))
        statusItem.menu = menu

        // Sound engine
        soundEngine = SoundEngine()

        // Global hotkeys
        globalHotkeys = GlobalHotkeys(sessionManager: sessionManager, soundEngine: soundEngine)
        globalHotkeys.start()

        // Auto-install hooks
        hookInstaller = HookInstaller()
        hookInstaller.installIfNeeded()

        // Process scanner — detects Claude sessions even without hooks
        processScanner = ProcessScanner(sessionManager: sessionManager)
        processScanner.start()

        // Context scanner — reads JSONL files for token usage
        contextScanner = ContextScanner(sessionManager: sessionManager)
        contextScanner.start()

        // Click outside panel to collapse (global = clicks in other apps)
        NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in
            guard let self = self, self.sessionManager.currentPanelState != .compact else { return }
            if !self.panel.frame.contains(NSEvent.mouseLocation) {
                self.sessionManager.currentPanelState = .compact
            }
        }
        // Also monitor local clicks on the panel itself
        NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown]) { [weak self] event in
            guard let self = self, self.sessionManager.currentPanelState != .compact else { return event }
            // Click in the notch area (top zone) = close
            let loc = event.locationInWindow
            let panelHeight = self.panel.frame.height
            let notchZone = NotchPanel.notchHeight
            if loc.y > (panelHeight - notchZone) {
                self.sessionManager.currentPanelState = .compact
            }
            return event
        }

        // Observe panel state changes for resize
        Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
            guard let self = self else { return }
            let newState = self.sessionManager.currentPanelState
            guard newState != self.lastPanelState else { return }
            self.lastPanelState = newState
            self.panel.transition(to: newState)
            if case .approval = newState {
                self.soundEngine.playAlert()
            } else if case .jump = newState {
                self.soundEngine.playComplete()
            }
        }
    }

    @objc private func statusBarClicked() {
        if sessionManager.currentPanelState == .compact {
            sessionManager.currentPanelState = .overview
        } else {
            sessionManager.currentPanelState = .compact
        }
        panel.transition(to: sessionManager.currentPanelState)
    }

    @objc private func installHooks() {
        hookInstaller.installIfNeeded()
    }

    @objc private func quitApp() {
        NSApp.terminate(nil)
    }

    func applicationWillTerminate(_ notification: Notification) {
        socketServer?.stop()
        globalHotkeys?.stop()
        processScanner?.stop()
        contextScanner?.stop()
        let pidPath = BuddyConstants.runtimeDirectory.appendingPathComponent("buddy.pid")
        try? FileManager.default.removeItem(at: pidPath)
    }
}
