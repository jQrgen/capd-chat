package org.nexa.capdchat

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ProtocolTest {
    @Test
    fun sha256MatchesKnownVectors() {
        assertEquals(
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            hexEncode(Sha256.hash(ByteArray(0))),
        )
        assertEquals(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            hexEncode(Sha256.hash("abc".encodeToByteArray())),
        )
    }

    @Test
    fun capdHashMatchesNexaCalcHash() {
        val body = CapdBody(
            createTime = 1_700_000_000,
            expiration = null,
            rescind = null,
            data = "hi".encodeToByteArray(),
            difficultyBits = 0x1e0fffff,
            nonce = byteArrayOf(1, 2, 3),
        )
        assertEquals(
            "02686900f15365000000000000000000000000000000000000000000000000ffffffff0f1e",
            hexEncode(hashPreimage(body)),
        )
        assertEquals("c6a51fb02786606ba991bc62ee385a9c90641770711c684e5f424593dea53ac6", capdHash(body))
    }

    @Test
    fun compactTargetMatchesBitcoinNBits() {
        assertEquals(
            "00000000ffff0000000000000000000000000000000000000000000000000000",
            compactTargetHex(0x1d00ffff),
        )
        assertEquals(
            "00000fffff000000000000000000000000000000000000000000000000000000",
            compactTargetHex(0x1e0fffff),
        )
    }

    @Test
    fun priorityFallsToZeroAfterTenMinutes() {
        val fresh = capdPriority(0x1e0fffff, 4, 0)
        assertTrue(fresh > 4096.0 && fresh < 4096.01)
        val aged = capdPriority(0x1e0fffff, 4, 600)
        assertTrue(kotlin.math.abs(aged) < 0.001)
    }

    @Test
    fun textRuleMatchesTheWebsite() {
        assertEquals("Grüß", decodePayload("Grüß".encodeToByteArray()))
        assertEquals("", decodePayload(ByteArray(0)))
        assertNull(decodePayload(byteArrayOf(0xc0.toByte(), 0x80.toByte())))
        assertNull(decodePayload(byteArrayOf(0x00)))
        assertEquals("a\nb", decodePayload("a\nb".encodeToByteArray()))
    }

    @Test
    fun versionAndExtversionUseTheNexaLayout() {
        val peer = CapdPeer("mainnet", "seeder.nexa.org:7228", 7228, seed = 1)
        val frames = peer.start(1_700_000_000)
        assertEquals(1, frames.size)
        val frame = frames[0]
        assertEquals("72271221", hexEncode(frame.copyOfRange(0, 4)))
        assertEquals("version", commandName(frame.copyOfRange(4, 16)))
        val length = Reader(frame.copyOfRange(16, 20)).u32()
        val payload = frame.copyOfRange(24, 24 + length.toInt())
        assertEquals(Net.NODE_EXTVERSION, versionServices(payload))
        assertEquals(0.toByte(), payload.last())

        val remote = frame(
            Net.MAINNET_MAGIC,
            Net.VERSION,
            9,
            encodeVersion(Net.NODE_EXTVERSION, 1_700_000_000, 7228, 99, "/nexa:1.0/", 800000, true),
        )
        val step = peer.receive(remote, 1_700_000_000)
        val ext = step.send.single { commandName(it.copyOfRange(4, 16)) == Net.EXTVERSION }
        val extLen = Reader(ext.copyOfRange(16, 20)).u32().toInt()
        val extPayload = ext.copyOfRange(24, 24 + extLen)
        assertEquals(1uL, extversionValue(extPayload, Net.BU_CAPD_VERSION))
        assertEquals(100uL, extversionValue(extPayload, Net.EXT_VERSION_KEY))
        assertEquals(1uL, extversionValue(extPayload, Net.BU_IGNORE_CHECKSUM))
    }

    @Test
    fun handshakeThenInvThenMessage() {
        val peer = CapdPeer("mainnet", "seeder.nexa.org:7228", 7228, seed = 2)
        peer.start(1_700_000_100)
        peer.receive(remoteVersion(), 1_700_000_100)
        val ext = theirExtversion()
        val afterExt = peer.receive(ext, 1_700_000_100)
        assertTrue(afterExt.send.any { commandName(it.copyOfRange(4, 16)) == Net.VERACK })
        assertEquals(1, afterExt.capdVersion)

        val ready = peer.receive(frame(Net.MAINNET_MAGIC, Net.VERACK, 3, ByteArray(0)), 1_700_000_100)
        assertEquals("listening", ready.phase)
        assertTrue(ready.send.any { commandName(it.copyOfRange(4, 16)) == Net.CAPDGETINFO })

        val body = CapdBody(
            createTime = 1_700_000_000,
            expiration = 600,
            rescind = null,
            data = "hello pool".encodeToByteArray(),
            difficultyBits = 0x1e0fffff,
            nonce = byteArrayOf(9),
        )
        val wireHash = hexDecode(capdHash(body))!!.reversedArray()
        val inv = frame(
            Net.MAINNET_MAGIC,
            Net.CAPDINV,
            4,
            Buf().apply {
                compact(Net.CAPD_MSG_TYPE.toULong())
                compact(1u)
                bytes(wireHash)
            }.toByteArray(),
        )
        val asked = peer.receive(inv, 1_700_000_100)
        val get = asked.send.single { commandName(it.copyOfRange(4, 16)) == Net.CAPDGETMSG }
        val getPayload = payloadOf(get)
        assertTrue(hexEncode(getPayload).contains(hexEncode(wireHash)))

        val msg = frame(
            Net.MAINNET_MAGIC,
            Net.CAPDMSG,
            5,
            Buf().apply {
                compact(1u)
                bytes(encodeCapd(body))
            }.toByteArray(),
        )
        val got = peer.receive(msg, 1_700_000_100)
        val decoded = got.messages.single()
        assertEquals("hello pool", decoded.text)
        assertEquals(capdHash(body), decoded.hash)
        assertEquals(600, decoded.expiration)
        assertEquals(10, decoded.size)
    }

    @Test
    fun pingEchoesCookieAndPayload() {
        val peer = CapdPeer("testnet", "testnetseeder.nexa.org:7230", 7230, seed = 3)
        peer.start(10)
        val ping = frame(Net.TESTNET_MAGIC, Net.PING, 0x11223344, Buf().apply { u64(0x55) }.toByteArray())
        val step = peer.receive(ping, 10)
        val pong = step.send.single { commandName(it.copyOfRange(4, 16)) == Net.PONG }
        assertEquals(0x11223344L, Reader(pong.copyOfRange(20, 24)).u32())
        assertEquals("72271222", hexEncode(pong.copyOfRange(0, 4)))
    }

    @Test
    fun prefixQueryCommandIsCapdq() {
        val peer = CapdPeer("mainnet", "seed:7228", 7228, prefixHex = "abcd", seed = 4)
        peer.start(10)
        peer.receive(remoteVersion(), 10)
        peer.receive(theirExtversion(), 10)
        val ready = peer.receive(frame(Net.MAINNET_MAGIC, Net.VERACK, 1, ByteArray(0)), 10)
        val queries = ready.send.filter { commandOf(it) == Net.CAPDQUERY }
        assertEquals("capdq", Net.CAPDQUERY)
        assertEquals(2, queries.size)
        assertEquals("636170647100000000000000", hexEncode(queries[0].copyOfRange(4, 16)))
        assertTrue(ready.send.none { commandOf(it) == "capdquery" })
    }

    @Test
    fun queryReplyRejectsCountsAboveTheProtocolMaxOrTheBytesLeft() {
        assertFailsWith<WireException> {
            decodeQueryReply(queryReply(Net.QUERY_HASH, 2_001u, ByteArray(0)), 0)
        }
        assertFailsWith<WireException> {
            decodeQueryReply(queryReply(Net.QUERY_HASH, 2u, ByteArray(10)), 0)
        }
        assertFailsWith<WireException> {
            decodeQueryReply(queryReply(Net.QUERY_MSG, 201u, ByteArray(0)), 0)
        }
        assertFailsWith<WireException> {
            decodeQueryReply(queryReply(Net.QUERY_MSG, 2u, ByteArray(Net.MIN_CAPD_MSG)), 0)
        }
        val huge = Buf().apply {
            u32(1)
            u8(Net.QUERY_HASH)
            u32(1)
            u8(0xff)
            repeat(8) { u8(0xff) }
        }.toByteArray()
        val error = assertFailsWith<WireException> { decodeQueryReply(huge, 0) }
        assertTrue(error.message!!.contains("exceeds"))

        val body = CapdBody(
            createTime = 1_700_000_000,
            expiration = null,
            rescind = null,
            data = "ok".encodeToByteArray(),
            difficultyBits = 0x1e0fffff,
            nonce = byteArrayOf(1),
        )
        val accepted = decodeQueryReply(queryReply(Net.QUERY_MSG, 1u, encodeCapd(body)), 1_700_000_000)
        assertEquals("ok", accepted.messages.single().text)
        val peer = CapdPeer("mainnet", "seed:7228", 7228, seed = 9)
        finish(peer)
        val step = peer.receive(
            frame(Net.MAINNET_MAGIC, Net.CAPDQREPLY, 4, queryReply(Net.QUERY_HASH, 2_001u, ByteArray(0))),
            10,
        )
        assertEquals("listening", step.phase)
        assertTrue(step.messages.isEmpty())
        assertTrue(step.note.contains("exceeds"))
    }

    @Test
    fun prefixMustBeALegalWidth() {
        assertNull(prefixBytes("aa"))
        assertEquals(2, prefixBytes("abcd")!!.size)
        assertNull(prefixBytes("abc"))
        val peer = CapdPeer("mainnet", "seed:7228", 7228, prefixHex = "abcd", seed = 4)
        finish(peer)
        val step = peer.updatePrefix("zz", 10)
        assertTrue(step.note.contains("hex"))
    }

    private fun finish(peer: CapdPeer) {
        peer.start(10)
        peer.receive(remoteVersion(), 10)
        peer.receive(theirExtversion(), 10)
        peer.receive(frame(Net.MAINNET_MAGIC, Net.VERACK, 1, ByteArray(0)), 10)
        assertEquals("listening", peer.phase)
    }

    private fun remoteVersion(): ByteArray = frame(
        Net.MAINNET_MAGIC,
        Net.VERSION,
        8,
        encodeVersion(Net.NODE_EXTVERSION, 1_700_000_000, 7228, 5, "/nexa:1.0/", 1, false),
    )

    private fun theirExtversion(): ByteArray = frame(
        Net.MAINNET_MAGIC,
        Net.EXTVERSION,
        8,
        encodeExtversion(mapOf(Net.BU_CAPD_VERSION to 1uL, Net.EXT_VERSION_KEY to 100uL)),
    )

    private fun commandOf(frame: ByteArray): String = commandName(frame.copyOfRange(4, 16))

    private fun queryReply(type: Int, count: ULong, body: ByteArray): ByteArray = Buf().apply {
        u32(1)
        u8(type)
        u32(count.toLong())
        compact(count)
        bytes(body)
    }.toByteArray()

    private fun payloadOf(frame: ByteArray): ByteArray {
        val length = Reader(frame.copyOfRange(16, 20)).u32().toInt()
        return frame.copyOfRange(24, 24 + length)
    }
}
