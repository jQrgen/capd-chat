package org.nexa.capdchat

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
        archive.accept(sample("short").copy(expiration = 60), "peer", 1_000)
        archive.accept(sample("keep").copy(expiration = 60), "peer", 1_000)
        archive.setKept("peer", sample("keep").hash, true)
        archive.prune(120_000)
        assertEquals("keep", archive.visible("peer", "", "all", "all").single().text)
    }

    private fun sample(text: String): DecodedCapd {
        val data = text.encodeToByteArray()
        return DecodedCapd(
            hash = "00000000" + hexEncode(Sha256.hash(data)).drop(8),
            created = 0,
            expiration = null,
            difficultyBits = 0x1e0fffff,
            priority = 8.0,
            initialPriority = 8.0,
            powTarget = compactTargetHex(0x1e0fffff),
            nonce = "01",
            size = data.size,
            data = hexEncode(data),
            text = text,
        )
    }
}
