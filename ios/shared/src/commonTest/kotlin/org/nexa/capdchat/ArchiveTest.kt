package org.nexa.capdchat

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ArchiveTest {
    @Test
    fun newestSortsLastAndSearchMatchesTextOrHex() {
        val archive = ChatArchive()
        archive.loadDemo(1_700_000_000_000)
        val feed = archive.visible(ChatArchive.DEMO_SERVER, "", "all", "all")
        assertEquals("Kept after the pool drops it.", feed.last().text)
        assertTrue(feed.last().inPool.not())
        val found = archive.visible(ChatArchive.DEMO_SERVER, "Grüß", "all", "all")
        assertEquals(1, found.size)
        val hexOnly = archive.visible(ChatArchive.DEMO_SERVER, "", "hex", "all")
        assertEquals(1, hexOnly.size)
        assertNull(hexOnly.single().text)
        val kept = archive.visible(ChatArchive.DEMO_SERVER, "", "all", "kept")
        assertEquals(1, kept.size)
    }

    @Test
    fun returningMessageStaysInTheArchiveAndComesBackToThePool() {
        val archive = ChatArchive()
        val message = sample("hello")
        archive.accept(message, "peer", 1_000)
        archive.markOffline("peer")
        assertFalse(archive.visible("peer", "", "all", "all").single().inPool)
        archive.accept(message.copy(priority = 3.0), "peer", 2_000)
        val kept = archive.visible("peer", "", "all", "all").single()
        assertTrue(kept.inPool)
        assertEquals(1_000, kept.firstSeen)
        assertEquals(2_000, kept.lastSeen)
        assertEquals(3.0, kept.priority)
    }

    @Test
    fun jsonRoundTripKeepsMessagesAfterARelaunch() {
        val archive = ChatArchive()
        archive.accept(sample("stay"), "peer", 5_000)
        archive.markOffline("peer")
        val copy = ChatArchive()
        assertTrue(copy.load(archive.encode(), 5_000))
        val message = copy.visible("peer", "stay", "text", "kept").single()
        assertEquals("stay", message.text)
        assertFalse(copy.load("{", 5_000))
    }

    @Test
    fun expiredOrUnprovenCopiesAreDroppedUnlessKept() {
        val archive = ChatArchive()
        archive.accept(sample("bad").copy(hash = "f".repeat(64)), "peer", 1_000)
        assertTrue(archive.visible("peer", "", "all", "all").isEmpty())
        archive.accept(sample("short", 60), "peer", 1_000)
        archive.accept(sample("keep", 60), "peer", 1_000)
        archive.setKept("peer", sample("keep", 60).hash, true)
        archive.prune(120_000)
        assertEquals("keep", archive.visible("peer", "", "all", "all").single().text)
    }

    @Test
    fun archiveIsCappedByBytes() {
        val big = "61".repeat(ClientLimits.MAX_CAPD_DATA)
        val count = (ChatArchive.MAX_STORED_BYTES / ClientLimits.MAX_CAPD_DATA).toInt()
        val rows = List(count + 3) {
            StoredCapd(it.toString(), 0, null, 0, 0.0, 0.0, "", "", ClientLimits.MAX_CAPD_DATA, big, null, false,
                ChatArchive.DEMO_SERVER, "network", it.toLong(), it.toLong())
        }
        val archive = ChatArchive()
        assertTrue(archive.load(Json.encodeToString(ArchiveSnapshot(messages = rows)), 1_000))
        assertEquals(count, archive.visible(ChatArchive.DEMO_SERVER, "", "all", "all").size)
    }

    private fun sample(text: String, expiration: Int? = null): DecodedCapd {
        val target = compactTargetHex(0x2000ffff)
        var n = 0
        while (true) {
            val body = CapdBody(0, expiration, null, text.encodeToByteArray(), 0x2000ffff, byteArrayOf(n.toByte(), (n shr 8).toByte()))
            if (capdHash(body) < target) return decodeCapd(Reader(encodeCapd(body)), 0)
            n++
        }
    }
}
