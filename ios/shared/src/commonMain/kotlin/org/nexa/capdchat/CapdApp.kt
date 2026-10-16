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
    private val peers = HashMap<String, CapdPeer>()
    private val archiveServer = HashMap<String, String>()

    fun archiveJson(): String = archive.encode()

    fun loadArchive(json: String, nowMs: Long): Boolean = archive.load(json, nowMs)

    fun showDemo(nowMs: Long) {
        archive.loadDemo(nowMs)
    }

    fun clearServer(server: String) {
        archive.clear(server)
    }

    fun setKept(server: String, hash: String, kept: Boolean) {
        archive.setKept(server, hash, kept)
    }

    fun markOffline(server: String) {
        archive.markOffline(server)
    }

    fun feedJson(server: String, query: String, kind: String, presence: String): String {
        return json.encodeToString(archive.visible(server, query, kind, presence))
    }

    fun latestServer(): String = archive.latestServer()

    /** [peerId] names one socket; several peers can feed the same archive [server]. */
    fun open(
        network: String,
        server: String,
        peerId: String,
        peerPort: Int,
        prefixHex: String,
        seed: Int,
        nowSeconds: Long,
    ): Ingest {
        val created = try {
            CapdPeer(network, peerId, peerPort, prefixHex, seed)
        } catch (error: WireException) {
            peers.remove(peerId)
            return Ingest("", "failed", error.message ?: "Could not open a peer.", -1, "", 0)
        }
        peers[peerId] = created
        archiveServer[peerId] = server
        val frames = created.start(nowSeconds)
        return Ingest(frames.joinToString("\n") { hexEncode(it) }, created.phase, created.note, -1, "", 0)
    }

    fun ingest(peerId: String, hexChunk: String, nowSeconds: Long, nowMs: Long): Ingest {
        val current = peers[peerId] ?: return Ingest("", "failed", "Not connected.", -1, "", 0)
        val bytes = hexDecode(hexChunk) ?: return Ingest("", "failed", "The phone passed malformed bytes.", -1, "", 0)
        val step = current.receive(bytes, nowSeconds)
        val server = archiveServer[peerId] ?: peerId
        step.messages.forEach { archive.accept(it, server, nowMs) }
        return ingestOf(step)
    }

    fun tick(peerId: String, nowSeconds: Long): Ingest {
        val current = peers[peerId] ?: return Ingest("", "failed", "Not connected.", -1, "", 0)
        return ingestOf(current.tick(nowSeconds))
    }

    fun close(peerId: String) {
        peers.remove(peerId)
        archiveServer.remove(peerId)
    }

    fun setPrefix(peerId: String, prefixHex: String, nowSeconds: Long): Ingest {
        val current = peers[peerId] ?: return Ingest("", "idle", "", -1, "", 0)
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
