package org.nexa.capdchat

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * String-only facade for Swift. Kotlin ByteArray and List are awkward across
 * the framework boundary, so the phone passes hex and JSON.
 */
class CapdApp {
    private val archive = ChatArchive()
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private var peer: CapdPeer? = null

    fun archiveJson(): String = archive.encode()

    fun loadArchive(json: String): Boolean = archive.load(json)

    fun showDemo(nowMs: Long) {
        archive.loadDemo(nowMs)
    }

    fun clearServer(server: String) {
        archive.clear(server)
    }

    fun markOffline(server: String) {
        archive.markOffline(server)
    }

    fun feedJson(server: String, query: String, kind: String, presence: String): String {
        return json.encodeToString(archive.visible(server, query, kind, presence))
    }

    fun latestServer(): String = archive.latestServer()

    fun open(network: String, serverId: String, peerPort: Int, prefixHex: String, seed: Int, nowSeconds: Long): Ingest {
        val created = try {
            CapdPeer(network, serverId, peerPort, prefixHex, seed)
        } catch (error: WireException) {
            peer = null
            return Ingest("", "failed", error.message ?: "Could not open a peer.", -1, "", 0)
        }
        peer = created
        val frames = created.start(nowSeconds)
        return Ingest(frames.joinToString("\n") { hexEncode(it) }, created.phase, created.note, -1, "", 0)
    }

    fun ingest(hexChunk: String, nowSeconds: Long, nowMs: Long): Ingest {
        val current = peer ?: return Ingest("", "failed", "Not connected.", -1, "", 0)
        val bytes = hexDecode(hexChunk) ?: return Ingest("", "failed", "The phone passed malformed bytes.", -1, "", 0)
        val step = current.receive(bytes, nowSeconds)
        step.messages.forEach { archive.accept(it, current.serverId, nowMs) }
        return ingestOf(step)
    }

    fun setPrefix(prefixHex: String, nowSeconds: Long): Ingest {
        val current = peer ?: return Ingest("", "idle", "", -1, "", 0)
        return ingestOf(current.updatePrefix(prefixHex, nowSeconds))
    }

    private fun ingestOf(step: PeerStep) = Ingest(
        sendHex = step.send.joinToString("\n") { hexEncode(it) },
        phase = step.phase,
        note = step.note,
        capdVersion = step.capdVersion,
        poolSummary = step.poolSummary,
        messageCount = step.messages.size,
    )
}

class Ingest(
    val sendHex: String,
    val phase: String,
    val note: String,
    val capdVersion: Int,
    val poolSummary: String,
    val messageCount: Int,
)
