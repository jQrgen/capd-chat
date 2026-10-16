import SwiftUI

struct RootView: View {
    @ObservedObject var model: SessionModel

    var body: some View {
        ZStack {
            Palette.bg.ignoresSafeArea()
            VStack(spacing: 0) {
                header
                feed
            }
        }
        .sheet(item: $model.selected) { item in
            DetailSheet(item: item)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text("CAPD")
                    .font(.system(size: 34, weight: .regular, design: .serif))
                Text("peer")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Palette.copper)
                    .textCase(.uppercase)
                    .tracking(1.4)
                Spacer()
                Button(model.listening ? "Stop" : "Listen") {
                    if model.listening {
                        model.stop()
                    } else {
                        model.listen()
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(model.listening ? Palette.rose : Palette.copper)
                .foregroundStyle(Palette.ink)
            }
            status
            VStack(alignment: .leading, spacing: 8) {
                Picker("Network", selection: $model.network) {
                    Text("Mainnet").tag("mainnet")
                    Text("Testnet").tag("testnet")
                }
                .pickerStyle(.segmented)
                .disabled(model.listening)
                TextField("seeder.nexa.org", text: $model.host)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .padding(10)
                    .background(Palette.card)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                TextField("Prefix, optional", text: $model.prefix)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding(10)
                    .background(Palette.card)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .onSubmit { model.applyPrefix() }
                Text("Empty prefix hears newly relayed messages. 2, 4, 8, or 16 hex bytes also asks for matches already in the pool.")
                    .font(.caption)
                    .foregroundStyle(Palette.faint)
            }
            HStack {
                TextField("Search text, hex, or hash", text: $model.query)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding(10)
                    .background(Palette.card)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .onChange(of: model.query) { _, _ in model.refresh() }
            }
            filterRow
            HStack {
                Button("Demo pool") { model.showDemo() }
                Button("Clear this archive") { model.clearArchive() }
            }
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(Palette.copper)
            if !model.peers.isEmpty {
                Text(model.peers)
                    .font(.caption.monospaced())
                    .foregroundStyle(Palette.muted)
            }
            if !model.pool.isEmpty {
                Text(model.pool)
                    .font(.caption.monospaced())
                    .foregroundStyle(Palette.muted)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 12)
    }

    private var status: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 8) {
                Circle().fill(statusColor).frame(width: 8, height: 8)
                Text(model.status.uppercased())
                    .font(.caption.weight(.bold))
                    .tracking(1.1)
                    .foregroundStyle(statusColor)
            }
            Text(model.detail)
                .font(.footnote)
                .foregroundStyle(Palette.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var statusColor: Color {
        switch model.tone {
        case "live": return Palette.mint
        case "demo", "connecting": return Palette.copper
        case "error", "unsupported": return Palette.rose
        default: return Palette.faint
        }
    }

    private var filterRow: some View {
        VStack(alignment: .leading, spacing: 6) {
            chipRow(options: [("all", "All"), ("text", "Text"), ("hex", "Hex")], selection: $model.kind)
            chipRow(options: [("all", "Any"), ("pool", "In pool"), ("kept", "Kept")], selection: $model.presence)
        }
    }

    private func chipRow(options: [(String, String)], selection: Binding<String>) -> some View {
        HStack(spacing: 6) {
            ForEach(options, id: \.0) { option in
                Button(option.1) {
                    selection.wrappedValue = option.0
                    model.refresh()
                }
                .font(.caption.weight(.semibold))
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(selection.wrappedValue == option.0 ? Palette.chipOn : Color.clear)
                .foregroundStyle(selection.wrappedValue == option.0 ? Palette.text : Palette.muted)
                .overlay(Capsule().stroke(selection.wrappedValue == option.0 ? Palette.copper.opacity(0.7) : Palette.line, lineWidth: 1))
                .clipShape(Capsule())
            }
        }
    }

    private var feed: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    if model.feed.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Nothing in this archive yet")
                                .font(.headline)
                            Text("Listen while the app is open, or load the demo pool. Messages stay on this iPhone after they leave the node.")
                                .foregroundStyle(Palette.muted)
                        }
                        .padding(.top, 28)
                    }
                    ForEach(model.feed) { item in
                        MessageCard(item: item)
                            .id(item.id)
                            .onTapGesture { model.selected = item }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
            }
            .onChange(of: model.jump) { _, _ in
                if let last = model.feed.last {
                    withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                }
            }
        }
    }
}

private struct MessageCard: View {
    let item: FeedItem

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(clock(item.created))
                    .font(.caption.monospaced())
                    .foregroundStyle(Palette.muted)
                Spacer()
                badge(item.inPool ? "In pool" : "Kept", color: item.inPool ? Palette.mint : Palette.kept)
                if item.isHex { badge("Hex", color: Palette.text) }
            }
            Text(item.body)
                .font(item.isHex ? .caption.monospaced() : .body)
                .foregroundStyle(Palette.text)
                .textSelection(.enabled)
                .lineLimit(8)
            Text("priority \(formatPriority(item.priority)) · initial \(formatPriority(item.initialPriority)) · \(String(format: "%08llx", item.difficultyBits))")
                .font(.caption2.monospaced())
                .foregroundStyle(Palette.faint)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(item.inPool ? Palette.card : Color.clear)
        .overlay(alignment: .leading) {
            Rectangle().fill(item.inPool ? Palette.copper : Palette.kept).frame(width: 3)
        }
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(item.inPool ? Palette.line : Palette.kept.opacity(0.45), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private func badge(_ title: String, color: Color) -> some View {
        Text(title.uppercased())
            .font(.caption2.monospaced().weight(.semibold))
            .foregroundStyle(color)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .overlay(Capsule().stroke(color.opacity(0.45), lineWidth: 1))
    }
}

private struct DetailSheet: View {
    let item: FeedItem
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text(item.body)
                        .font(item.isHex ? .caption.monospaced() : .body)
                        .textSelection(.enabled)
                    row("Hash", item.hash)
                    row("Created", "\(clock(item.created)) · \(item.created)")
                    row("Priority", "\(formatPriority(item.priority)) (initial \(formatPriority(item.initialPriority)))")
                    row("Difficulty", String(format: "%08llx", item.difficultyBits))
                    row("Target", item.powTarget)
                    row("Nonce", item.nonce)
                    row("Payload", "\(item.size) bytes")
                    row("Expiry", expiry(item))
                    Text(hexLines(item.data))
                        .font(.caption.monospaced())
                        .textSelection(.enabled)
                        .padding(10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Palette.bg)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                }
                .padding(16)
            }
            .background(Palette.bg)
            .navigationTitle(item.inPool ? "In the pool" : "Kept locally")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Copy hash") {
                        UIPasteboard.general.string = item.hash
                    }
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    private func row(_ name: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(name.uppercased()).font(.caption2.weight(.bold)).foregroundStyle(Palette.faint).tracking(0.8)
            Text(value).font(.caption.monospaced()).textSelection(.enabled)
        }
    }
}

private enum Palette {
    static let bg = Color(red: 0x12 / 255, green: 0x11 / 255, blue: 0x0f / 255)
    static let card = Color(red: 0x1d / 255, green: 0x1a / 255, blue: 0x16 / 255)
    static let text = Color(red: 0xf6 / 255, green: 0xf1 / 255, blue: 0xe8 / 255)
    static let muted = Color(red: 0xb7 / 255, green: 0xad / 255, blue: 0x9f / 255)
    static let faint = Color(red: 0x85 / 255, green: 0x7c / 255, blue: 0x70 / 255)
    static let copper = Color(red: 0xe2 / 255, green: 0xa1 / 255, blue: 0x5a / 255)
    static let ink = Color(red: 0x24 / 255, green: 0x18 / 255, blue: 0x0c / 255)
    static let mint = Color(red: 0xb7 / 255, green: 0xd7 / 255, blue: 0xc3 / 255)
    static let rose = Color(red: 0xe7 / 255, green: 0xa3 / 255, blue: 0x96 / 255)
    static let kept = Color(red: 0xd2 / 255, green: 0xc2 / 255, blue: 0xa4 / 255)
    static let line = Color.white.opacity(0.12)
    static let chipOn = Color(red: 0x3a / 255, green: 0x31 / 255, blue: 0x26 / 255)
}

private func clock(_ seconds: Int64) -> String {
    let date = Date(timeIntervalSince1970: TimeInterval(seconds))
    let formatter = DateFormatter()
    formatter.dateFormat = "HH:mm:ss"
    return formatter.string(from: date)
}

private func formatPriority(_ value: Double) -> String {
    guard value.isFinite else { return "—" }
    let abs = Swift.abs(value)
    if abs != 0 && (abs < 0.01 || abs >= 1_000_000) {
        return String(format: "%.2e", value)
    }
    let rounded = (value * 100).rounded() / 100
    if rounded == rounded.rounded() { return String(Int(rounded)) }
    return String(rounded)
}

private func expiry(_ item: FeedItem) -> String {
    guard let expiration = item.expiration else { return "no expiry" }
    let end = item.created + Int64(expiration)
    let now = Int64(Date().timeIntervalSince1970)
    if now >= end { return "expired" }
    let left = end - now
    if left < 60 { return "expires in \(left)s" }
    if left < 3600 { return "expires in \((left + 59) / 60)m" }
    return "expires in \((left + 3599) / 3600)h"
}

private func hexLines(_ hex: String) -> String {
    let pairs = stride(from: 0, to: hex.count, by: 2).compactMap { offset -> String? in
        guard let start = hex.index(hex.startIndex, offsetBy: offset, limitedBy: hex.endIndex),
              let end = hex.index(start, offsetBy: 2, limitedBy: hex.endIndex) else { return nil }
        return String(hex[start..<end])
    }
    return stride(from: 0, to: pairs.count, by: 16).map { start in
        pairs[start..<min(start + 16, pairs.count)].joined(separator: " ")
    }.joined(separator: "\n")
}
