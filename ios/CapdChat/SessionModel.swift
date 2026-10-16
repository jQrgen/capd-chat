import Foundation
import Network
import Shared

struct FeedItem: Identifiable, Equatable {
    var id: String
    var hash: String
    var created: Int64
    var text: String?
    var data: String
    var priority: Double
    var initialPriority: Double
    var difficultyBits: Int64
    var inPool: Bool
    var expiration: Int?
    var size: Int
    var nonce: String
    var powTarget: String

    var body: String { text ?? hexLines(data) }
    var isHex: Bool { text == nil }
}

@MainActor
final class SessionModel: ObservableObject {
    @Published var feed: [FeedItem] = []
    @Published var status = "Not listening"
    @Published var detail = "Connect to a Nexa peer, or open the demo pool."
    @Published var tone = "disconnected"
    @Published var host = "seeder.nexa.org"
    @Published var network = "mainnet"
    @Published var query = ""
    @Published var kind = "all"
    @Published var presence = "all"
    @Published var prefix = ""
    @Published var listening = false
    @Published var pool = ""
    @Published var peers = ""
    @Published var server = "demo"
    @Published var selected: FeedItem?
    @Published var jump = 0

    private let app = CapdApp()
    private var links: [String: Link] = [:]
    private var ticker: Task<Void, Never>?
    private var wantListen = false
    private var generation = 0
    private let fileURL: URL

    init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let directory = base.appendingPathComponent("capd-chat", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        fileURL = directory.appendingPathComponent("messages.json")
        if let text = try? String(contentsOf: fileURL, encoding: .utf8) {
            _ = app.loadArchive(json: text, nowMs: nowMs())
        }
        server = app.latestServer()
        refresh()
    }

    func listen() {
        wantListen = true
        openSocket()
    }

    func stop() {
        wantListen = false
        closeSocket(markOffline: true)
        status = "Not listening"
        tone = "disconnected"
        detail = "The archive stays on this iPhone."
        pool = ""
        refresh()
    }

    func pauseForBackground() {
        guard wantListen || !links.isEmpty else { return }
        closeSocket(markOffline: true)
        status = "Paused"
        tone = "disconnected"
        detail = "iOS suspends this peer socket while CAPD Chat is in the background. It resumes when you come back."
        refresh()
    }

    func resumeIfNeeded() {
        guard wantListen else { return }
        openSocket()
    }

    func showDemo() {
        wantListen = false
        closeSocket(markOffline: false)
        server = "demo"
        app.showDemo(nowMs: nowMs())
        status = "Demo pool"
        tone = "demo"
        detail = "Sample messages on this iPhone. Nothing was sent to Nexa."
        pool = ""
        listening = false
        persist()
        refresh()
        jump += 1
    }

    func clearArchive() {
        app.clearServer(server: server)
        persist()
        refresh()
    }

    func applyPrefix() {
        guard listening else { return }
        for id in links.keys {
            let result = app.setPrefix(peerId: id, prefixHex: prefix, nowSeconds: nowSeconds())
            write(result.sendHex, to: id)
            note(from: result)
        }
    }

    func refresh() {
        feed = decodeFeed(app.feedJson(server: server, query: query, kind: kind, presence: presence))
    }

    private func openSocket() {
        guard let endpoint = endpoint() else {
            status = "Check the host"
            tone = "error"
            detail = "Use a hostname, or hostname:port. Mainnet peers listen on 7228 and testnet on 7230."
            listening = false
            return
        }
        closeSocket(markOffline: false)
        generation += 1
        let token = generation
        let seeds = Self.seeds[network] ?? []
        let seeded = seeds.contains(endpoint.host)
        server = seeded ? "\(network)/seeds" : "\(network)/\(endpoint.host):\(endpoint.port)"
        status = "Connecting"
        tone = "connecting"
        detail = seeded ? "Looking up peers from \(seeds.count) seeds." : "Opening a TCP peer to \(endpoint.host):\(endpoint.port)."
        pool = ""
        peers = ""
        listening = true
        refresh()

        let hosts = seeded ? seeds : [endpoint.host]
        let port = endpoint.port
        Task.detached {
            let targets = seeded ? pickPeers(hosts: hosts, port: port) : [endpoint.host]
            await MainActor.run {
                guard token == self.generation else { return }
                if targets.isEmpty {
                    self.fail("No peers found from the seeds.")
                    return
                }
                for target in targets { self.openPeer(host: target, port: port, token: token) }
                self.startTicker(token)
            }
        }
    }

    private func openPeer(host: String, port: UInt16, token: Int) {
        let id = "\(host):\(port)"
        let opened = app.open(
            network: network,
            server: server,
            peerId: id,
            peerPort: Int32(port),
            prefixHex: prefix,
            seed: Int32.random(in: 1...Int32.max),
            nowSeconds: nowSeconds()
        )
        if opened.phase == "failed" {
            dropPeer(id, reason: opened.note)
            return
        }
        let connection = NWConnection(
            host: NWEndpoint.Host(host),
            port: NWEndpoint.Port(rawValue: port) ?? .any,
            using: .tcp
        )
        links[id] = Link(connection: connection, pending: opened.sendHex)
        connection.stateUpdateHandler = { [weak self] state in
            Task { @MainActor in
                guard let self, token == self.generation else { return }
                self.onState(state, id: id, token: token)
            }
        }
        connection.start(queue: .global(qos: .userInitiated))
    }

    private func onState(_ state: NWConnection.State, id: String, token: Int) {
        switch state {
        case .ready:
            guard var link = links[id] else { return }
            if case .hostPort(let host, _) = link.connection.currentPath?.remoteEndpoint {
                link.address = "\(host)"
            }
            write(link.pending, to: id)
            link.pending = ""
            links[id] = link
            updatePeers()
            readLoop(id, token)
        case .failed(let error):
            dropPeer(id, reason: "The connection failed. \(error.localizedDescription)")
        case .waiting(let error):
            detail = error.localizedDescription
        default:
            break
        }
    }

    private func readLoop(_ id: String, _ token: Int) {
        links[id]?.connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
            Task { @MainActor in
                guard let self, token == self.generation, self.links[id] != nil else { return }
                if let data, !data.isEmpty {
                    let result = self.app.ingest(peerId: id, hexChunk: data.hexEncoded(), nowSeconds: nowSeconds(), nowMs: nowMs())
                    if !self.handle(result, id: id) { return }
                    if result.messageCount > 0 {
                        self.persist()
                        self.jump += 1
                    }
                    self.refresh()
                }
                if isComplete || error != nil {
                    self.dropPeer(id, reason: error?.localizedDescription ?? "The peer closed the connection.")
                    return
                }
                self.readLoop(id, token)
            }
        }
    }

    /// Returns false when the peer was dropped.
    private func handle(_ result: Ingest, id: String) -> Bool {
        write(result.sendHex, to: id)
        if result.phase == "failed" {
            dropPeer(id, reason: result.note)
            return false
        }
        if result.phase == "listening" {
            links[id]?.listening = true
            listening = true
            updatePeers()
        }
        note(from: result)
        return true
    }

    private func startTicker(_ token: Int) {
        ticker?.cancel()
        ticker = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                guard let self, token == self.generation else { return }
                for id in self.links.keys {
                    _ = self.handle(self.app.tick(peerId: id, nowSeconds: nowSeconds()), id: id)
                }
            }
        }
    }

    private func dropPeer(_ id: String, reason: String) {
        links[id]?.connection.cancel()
        links[id] = nil
        app.close(peerId: id)
        updatePeers()
        if links.isEmpty && wantListen {
            fail(reason)
        }
    }

    private func updatePeers() {
        let up = links.values.filter { $0.listening }.map { $0.address ?? "?" }.sorted()
        peers = up.isEmpty ? "" : "Connected to \(up.count) peer\(up.count == 1 ? "" : "s"): \(up.joined(separator: ", "))"
    }

    private func note(from result: Ingest) {
        if result.phase == "listening" {
            status = result.capdVersion > 0 ? "Listening" : "Connected"
            tone = result.capdVersion > 0 ? "live" : "unsupported"
        } else if result.phase == "handshake" {
            status = "Handshake"
            tone = "connecting"
        } else if result.phase == "failed" {
            status = "Peer closed"
            tone = "error"
        }
        if !result.note.isEmpty { detail = result.note }
        if !result.poolSummary.isEmpty { pool = result.poolSummary }
    }

    private func write(_ hexFrames: String, to id: String) {
        guard let connection = links[id]?.connection else { return }
        let chunks = hexFrames.split(separator: "\n").map { Data(hex: String($0)) }
        for chunk in chunks where !chunk.isEmpty {
            connection.send(content: chunk, completion: .contentProcessed { _ in })
        }
    }

    private func fail(_ message: String) {
        closeSocket(markOffline: true)
        wantListen = false
        listening = false
        status = "Not listening"
        tone = "error"
        detail = message
        refresh()
    }

    private func closeSocket(markOffline: Bool) {
        generation += 1
        ticker?.cancel()
        ticker = nil
        for (id, link) in links {
            link.connection.cancel()
            app.close(peerId: id)
        }
        links = [:]
        peers = ""
        if markOffline {
            app.markOffline(server: server)
            persist()
        }
        listening = false
    }

    private func persist() {
        try? app.archiveJson().write(to: fileURL, atomically: true, encoding: .utf8)
    }

    private func endpoint() -> (host: String, port: UInt16)? {
        var text = host.trimmingCharacters(in: .whitespacesAndNewlines)
        if let scheme = text.range(of: "://") {
            text = String(text[scheme.upperBound...])
        }
        text = text.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        var port: UInt16 = network == "testnet" ? 7230 : 7228
        var name = text
        if let colon = text.lastIndex(of: ":"), text.index(after: colon) < text.endIndex {
            let suffix = text[text.index(after: colon)...]
            if let parsed = UInt16(suffix) {
                name = String(text[..<colon])
                port = parsed
            }
        }
        if name.isEmpty { return nil }
        return (name, port)
    }

    private struct Link {
        var connection: NWConnection
        var pending: String
        var address: String?
        var listening = false
    }

    static let seeds: [String: [String]] = [
        "mainnet": ["seed.nextchain.cash", "seeder.nexa.org", "nexa-seeder.bitcoinunlimited.info"],
        "testnet": ["nexa-testnet-seeder.bitcoinunlimited.info", "testnetseeder.nexa.org"],
    ]
}

/// Up to two addresses from each seed, at most four peers in all.
private func pickPeers(hosts: [String], port: UInt16) -> [String] {
    var picked: [String] = []
    for host in hosts {
        var hints = addrinfo()
        hints.ai_socktype = SOCK_STREAM
        var result: UnsafeMutablePointer<addrinfo>?
        guard getaddrinfo(host, String(port), &hints, &result) == 0 else { continue }
        defer { freeaddrinfo(result) }
        var fromSeed = 0
        var node = result
        while let info = node, fromSeed < 2 {
            var name = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            if getnameinfo(info.pointee.ai_addr, info.pointee.ai_addrlen, &name, socklen_t(name.count),
                           nil, 0, NI_NUMERICHOST) == 0 {
                let address = String(cString: name)
                if !picked.contains(address) {
                    picked.append(address)
                    fromSeed += 1
                }
            }
            node = info.pointee.ai_next
        }
    }
    return Array(picked.prefix(4))
}

private func nowSeconds() -> Int64 { Int64(Date().timeIntervalSince1970) }
private func nowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

private extension Data {
    func hexEncoded() -> String {
        map { String(format: "%02x", $0) }.joined()
    }

    init(hex: String) {
        var out = Data()
        var index = hex.startIndex
        while index < hex.endIndex {
            let next = hex.index(index, offsetBy: 2, limitedBy: hex.endIndex) ?? hex.endIndex
            if next == hex.endIndex && hex.distance(from: index, to: next) != 2 { break }
            if let byte = UInt8(hex[index..<next], radix: 16) { out.append(byte) }
            index = next
        }
        self = out
    }
}

private func decodeFeed(_ json: String) -> [FeedItem] {
    guard let data = json.data(using: .utf8),
          let rows = try? JSONDecoder().decode([FeedWire].self, from: data) else { return [] }
    return rows.map { row in
        FeedItem(
            id: row.hash,
            hash: row.hash,
            created: row.created,
            text: row.text,
            data: row.data,
            priority: row.priority,
            initialPriority: row.initialPriority,
            difficultyBits: row.difficultyBits,
            inPool: row.inPool,
            expiration: row.expiration,
            size: row.size,
            nonce: row.nonce,
            powTarget: row.powTarget
        )
    }
}

private struct FeedWire: Decodable {
    var hash: String
    var created: Int64
    var expiration: Int?
    var difficultyBits: Int64
    var priority: Double
    var initialPriority: Double
    var powTarget: String
    var nonce: String
    var size: Int
    var data: String
    var text: String?
    var inPool: Bool
}

private func hexLines(_ hex: String) -> String {
    let pairs = stride(from: 0, to: hex.count, by: 2).map { offset -> String in
        let start = hex.index(hex.startIndex, offsetBy: offset)
        let end = hex.index(start, offsetBy: 2, limitedBy: hex.endIndex) ?? hex.endIndex
        return String(hex[start..<end])
    }
    return stride(from: 0, to: pairs.count, by: 16).map { start in
        pairs[start..<min(start + 16, pairs.count)].joined(separator: " ")
    }.joined(separator: "\n")
}
