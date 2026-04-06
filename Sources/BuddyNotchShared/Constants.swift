import Foundation

public enum BuddyConstants {
    public static let runtimeDirectory: URL = {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".buddy-notch")
    }()

    public static let socketPath: String = {
        runtimeDirectory.appendingPathComponent("buddy.sock").path
    }()

    public static let pidFilePath: String = {
        runtimeDirectory.appendingPathComponent("buddy.pid").path
    }()

    public static let bridgeBinaryName = "BuddyBridge"
}
