import Foundation
import BuddyNotchShared

/// POSIX Unix domain socket server using GCD for non-blocking I/O.
/// Listens at ~/.buddy-notch/buddy.sock, reads NDJSON messages from BuddyBridge clients.
final class SocketServer: @unchecked Sendable {
    private let socketQueue = DispatchQueue(label: "com.buddynotch.socket")
    private var listenFd: Int32 = -1
    private var listenSource: DispatchSourceRead?
    private var clientSources: [Int32: DispatchSourceRead] = [:]
    private var clientBuffers: [Int32: Data] = [:]

    /// Called on socketQueue when a complete NDJSON message is parsed
    private let onMessage: @Sendable (SocketMessage, Int32) -> Void

    init(onMessage: @escaping @Sendable (SocketMessage, Int32) -> Void) {
        self.onMessage = onMessage
    }

    func start() throws {
        let dir = BuddyConstants.runtimeDirectory
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        // Remove stale socket
        unlink(BuddyConstants.socketPath)

        // Create socket
        listenFd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard listenFd >= 0 else {
            throw SocketError.createFailed(errno)
        }

        // Bind
        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        let path = BuddyConstants.socketPath
        withUnsafeMutablePointer(to: &addr.sun_path) { ptr in
            path.withCString { cstr in
                _ = memcpy(ptr, cstr, min(path.utf8.count, 103))
            }
        }

        let addrLen = socklen_t(MemoryLayout<sockaddr_un>.offset(of: \.sun_path)! + path.utf8.count + 1)
        let bindResult = withUnsafePointer(to: &addr) { ptr in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
                bind(listenFd, sockPtr, addrLen)
            }
        }
        guard bindResult == 0 else {
            close(listenFd)
            throw SocketError.bindFailed(errno)
        }

        // Listen
        guard listen(listenFd, 5) == 0 else {
            close(listenFd)
            throw SocketError.listenFailed(errno)
        }

        // Set non-blocking
        let flags = fcntl(listenFd, F_GETFL)
        _ = fcntl(listenFd, F_SETFL, flags | O_NONBLOCK)

        // Accept source
        let source = DispatchSource.makeReadSource(fileDescriptor: listenFd, queue: socketQueue)
        source.setEventHandler { [weak self] in
            self?.acceptClient()
        }
        source.setCancelHandler { [weak self] in
            if let fd = self?.listenFd, fd >= 0 {
                close(fd)
            }
        }
        listenSource = source
        source.resume()
    }

    func stop() {
        listenSource?.cancel()
        listenSource = nil

        for (fd, source) in clientSources {
            source.cancel()
            close(fd)
        }
        clientSources.removeAll()
        clientBuffers.removeAll()

        unlink(BuddyConstants.socketPath)
    }

    /// Send a response back to a connected client
    func sendResponse(_ response: ApprovalResponse, to clientFd: Int32) {
        socketQueue.async {
            let encoder = JSONEncoder()
            guard var data = try? encoder.encode(response) else { return }
            data.append(0x0A) // newline
            data.withUnsafeBytes { ptr in
                _ = write(clientFd, ptr.baseAddress!, data.count)
            }
        }
    }

    // MARK: - Private

    private func acceptClient() {
        var clientAddr = sockaddr_un()
        var clientAddrLen = socklen_t(MemoryLayout<sockaddr_un>.size)
        let clientFd = withUnsafeMutablePointer(to: &clientAddr) { ptr in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
                accept(listenFd, sockPtr, &clientAddrLen)
            }
        }
        guard clientFd >= 0 else { return }

        // Set non-blocking
        let flags = fcntl(clientFd, F_GETFL)
        _ = fcntl(clientFd, F_SETFL, flags | O_NONBLOCK)

        clientBuffers[clientFd] = Data()

        let source = DispatchSource.makeReadSource(fileDescriptor: clientFd, queue: socketQueue)
        source.setEventHandler { [weak self] in
            self?.readClient(clientFd)
        }
        source.setCancelHandler { [weak self] in
            self?.clientBuffers.removeValue(forKey: clientFd)
            self?.clientSources.removeValue(forKey: clientFd)
            close(clientFd)
        }
        clientSources[clientFd] = source
        source.resume()
    }

    private func readClient(_ fd: Int32) {
        var buf = [UInt8](repeating: 0, count: 4096)
        let n = read(fd, &buf, buf.count)

        if n <= 0 {
            // Client disconnected or error
            clientSources[fd]?.cancel()
            return
        }

        clientBuffers[fd, default: Data()].append(contentsOf: buf[0..<n])

        // Parse complete NDJSON lines
        while let buffer = clientBuffers[fd],
              let newlineIndex = buffer.firstIndex(of: 0x0A) {
            let lineData = buffer[buffer.startIndex..<newlineIndex]
            clientBuffers[fd] = Data(buffer[(newlineIndex + 1)...])

            guard !lineData.isEmpty else { continue }

            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            if let message = try? decoder.decode(SocketMessage.self, from: Data(lineData)) {
                onMessage(message, fd)
            }
        }
    }
}

enum SocketError: Error {
    case createFailed(Int32)
    case bindFailed(Int32)
    case listenFailed(Int32)
}
