package org.nexa.capdchat

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/** A CAPD message kept on the device, including messages that have left the pool. */
@Serializable
data class StoredCapd(
    val hash: String,
    val created: Long,
    val expiration: Int? = null,
    val difficultyBits: Long,
    val priority: Double,
    val initialPriority: Double,
    val powTarget: String,
    val nonce: String,
    val size: Int,
    val data: String,
    val text: String? = null,
    val inPool: Boolean,
    val server: String,
    val origin: String,
    val firstSeen: Long,
    val lastSeen: Long,
)

@Serializable
data class ArchiveSnapshot(
    val version: Int = 1,
    val messages: List<StoredCapd> = emptyList(),
)

/**
 * In-memory archive. The iOS app writes [encode] to a file in Application Support.
 * Newest messages sort last, matching the website feed.
 */
class ChatArchive {
    private val messages = ArrayList<StoredCapd>()
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    fun accept(message: DecodedCapd, server: String, nowMs: Long) {
        val index = messages.indexOfFirst { it.hash == message.hash && it.server == server }
        if (index >= 0) {
            val prior = messages[index]
            messages[index] = prior.copy(
                priority = message.priority,
                initialPriority = message.initialPriority,
                inPool = true,
                lastSeen = nowMs,
                expiration = message.expiration,
                difficultyBits = message.difficultyBits,
                powTarget = message.powTarget,
                nonce = message.nonce,
                size = message.size,
                data = message.data,
                text = message.text,
            )
            return
        }
        messages.add(
            StoredCapd(
                hash = message.hash,
                created = message.created,
                expiration = message.expiration,
                difficultyBits = message.difficultyBits,
                priority = message.priority,
                initialPriority = message.initialPriority,
                powTarget = message.powTarget,
                nonce = message.nonce,
                size = message.size,
                data = message.data,
                text = message.text,
                inPool = true,
                server = server,
                origin = "network",
                firstSeen = nowMs,
                lastSeen = nowMs,
            ),
        )
    }

    fun markOffline(server: String) {
        for (i in messages.indices) {
            if (messages[i].server == server && messages[i].inPool) {
                messages[i] = messages[i].copy(inPool = false)
            }
        }
    }

    fun clear(server: String) {
        messages.removeAll { it.server == server }
    }

    fun clearAll() {
        messages.clear()
    }

    fun latestServer(): String = messages.maxByOrNull { it.lastSeen }?.server ?: DEMO_SERVER

    fun visible(server: String, query: String, kind: String, presence: String): List<StoredCapd> {
        return messages
            .filter { it.server == server && matches(it, query, kind, presence) }
            .sortedWith(compareBy<StoredCapd> { it.created }.thenBy { it.firstSeen }.thenBy { it.hash })
    }

    fun encode(): String = json.encodeToString(ArchiveSnapshot(messages = messages.toList()))

    fun load(text: String): Boolean {
        return try {
            val snapshot = json.decodeFromString<ArchiveSnapshot>(text)
            messages.clear()
            messages.addAll(snapshot.messages)
            true
        } catch (_: Exception) {
            false
        }
    }

    /** Local sample pool, so the feed can be read before a peer answers. */
    fun loadDemo(nowMs: Long) {
        clear(DEMO_SERVER)
        val nowSec = nowMs / 1000
        val samples = listOf(
            demo("aa", "The pool is a shared scratch space. Messages leave when their priority does.", nowSec - 180, nowMs - 180_000),
            demo("bb", "Grüß — a prefix can find a protocol, and the rest of the text is just chat.", nowSec - 90, nowMs - 90_000),
            demo("cc", null, nowSec - 40, nowMs - 40_000, ByteArray(4) { 0xc0.toByte() }),
            demo("dd", "Kept after the pool drops it.", nowSec - 20, nowMs - 20_000, inPool = false),
        )
        messages.addAll(samples)
    }

    private fun matches(message: StoredCapd, query: String, kind: String, presence: String): Boolean {
        if (kind == "text" && message.text == null) return false
        if (kind == "hex" && message.text != null) return false
        if (presence == "pool" && !message.inPool) return false
        if (presence == "kept" && message.inPool) return false
        val trimmed = query.trim().lowercase()
        if (trimmed.isEmpty()) return true
        val compact = trimmed.replace(" ", "")
        if (compact.isNotEmpty() && message.hash.contains(compact)) return true
        if (compact.isNotEmpty() && message.data.contains(compact)) return true
        return message.text?.lowercase()?.contains(trimmed) == true
    }

    private fun demo(
        tag: String,
        text: String?,
        created: Long,
        seen: Long,
        raw: ByteArray? = null,
        inPool: Boolean = true,
    ): StoredCapd {
        val data = raw ?: (text ?: "").encodeToByteArray()
        return StoredCapd(
            hash = tag.repeat(32).take(64),
            created = created,
            expiration = null,
            difficultyBits = 0x1e0fffff,
            priority = if (inPool) 12.5 else 0.4,
            initialPriority = 40.0,
            powTarget = compactTargetHex(0x1e0fffff),
            nonce = "010203",
            size = data.size,
            data = hexEncode(data),
            text = text ?: decodePayload(data),
            inPool = inPool,
            server = DEMO_SERVER,
            origin = "network",
            firstSeen = seen,
            lastSeen = seen,
        )
    }

    companion object {
        const val DEMO_SERVER = "demo"
    }
}
