package org.nexa.capdchat

/**
 * Listen-only Nexa peer. The caller owns the TCP socket: [start] and [receive]
 * return the frames to write, and [receive] returns any CAPD messages inside
 * the bytes just read.
 *
 * Handshake follows nexa `net_processing.cpp`: we send `version` with
 * NODE_EXTVERSION, then `extversion` (including BU_CAPD_VERSION) before
 * `verack`. CAPD turns on for the remote node only when that key is non-zero.
 */
class CapdPeer(
    val network: String,
    val serverId: String,
    val peerPort: Int,
    prefixHex: String = "",
    seed: Int = 1,
) {
    private val magic = magicFor(network)
    private val parser = FrameParser(magic)
    private val random = SplitMix(seed.toLong() and 0xffffffffL)
    private val nonce = random.next()
    private var headerCookie = 1L
    private var prefix: ByteArray = prefixBytes(prefixHex) ?: ByteArray(0)
    private var phaseName = "idle"
    private var noteText = ""
    private var capd = -1
    private var pool = ""
    private var sentVerack = false
    private var gotVerack = false
    private var subscribed = false
    private val seen = HashSet<String>()
    private val queryCookie = 1L

    fun start(nowSeconds: Long): List<ByteArray> {
        phaseName = "handshake"
        noteText = "Sending version to $serverId."
        val payload = encodeVersion(
            services = Net.NODE_EXTVERSION,
            nowSeconds = nowSeconds,
            peerPort = peerPort,
            nonce = nonce,
            userAgent = USER_AGENT,
            startHeight = 0,
            relay = false,
        )
        return listOf(send(Net.VERSION, payload))
    }

    fun receive(bytes: ByteArray, nowSeconds: Long): PeerStep {
        val outgoing = ArrayList<ByteArray>()
        val found = ArrayList<DecodedCapd>()
        try {
            for (frame in parser.push(bytes)) {
                when (frame.command) {
                    Net.VERSION -> onVersion(frame.payload, outgoing)
                    Net.EXTVERSION -> onExtversion(frame.payload, outgoing)
                    Net.VERACK -> onVerack(outgoing)
                    Net.PING -> outgoing.add(send(Net.PONG, frame.payload, frame.cookie))
                    Net.CAPDINFO -> onInfo(frame.payload)
                    Net.CAPDINV -> onInv(frame.payload, outgoing)
                    Net.CAPDMSG -> found.addAll(takeNew(decodeCapdVector(frame.payload, nowSeconds)))
                    Net.CAPDQREPLY -> onReply(frame.payload, nowSeconds, outgoing, found)
                    Net.REJECT -> {
                        noteText = rejectReason(frame.payload)
                        phaseName = "failed"
                    }
                }
            }
        } catch (error: WireException) {
            phaseName = "failed"
            noteText = error.message ?: "Could not read a P2P message."
        }
        return step(outgoing, found)
    }

    fun updatePrefix(prefixHex: String, nowSeconds: Long): PeerStep {
        val parsed = prefixBytes(prefixHex)
        if (prefixHex.isNotBlank() && parsed == null) {
            noteText = "A prefix is 2, 4, 8, or 16 bytes of hex."
            return step(emptyList(), emptyList())
        }
        val next = parsed ?: ByteArray(0)
        val outgoing = ArrayList<ByteArray>()
        if (subscribed && !prefix.contentEquals(next)) {
            outgoing.add(send(Net.CAPDREMOVE, Buf().apply { u32(queryCookie) }.toByteArray()))
            if (next.isNotEmpty()) outgoing.addAll(query(next))
        }
        prefix = next
        if (next.isEmpty() && subscribed) noteText = "Listening for relayed messages."
        return step(outgoing, emptyList())
    }

    val phase: String get() = phaseName
    val note: String get() = noteText

    private fun onVersion(payload: ByteArray, outgoing: MutableList<ByteArray>) {
        val services = try {
            versionServices(payload)
        } catch (_: WireException) {
            phaseName = "failed"
            noteText = "The version message was truncated."
            return
        }
        if (services and Net.NODE_EXTVERSION != 0L) {
            outgoing.add(
                send(
                    Net.EXTVERSION,
                    encodeExtversion(
                        mapOf(
                            Net.EXT_VERSION_KEY to Net.EXT_VERSION_VALUE,
                            Net.BU_IGNORE_CHECKSUM to 1uL,
                            Net.BU_CAPD_VERSION to 1uL,
                        ),
                    ),
                ),
            )
            noteText = "Waiting for extversion."
        } else {
            sendVerack(outgoing)
            noteText = "This peer does not speak extversion, so it will not relay CAPD."
            capd = 0
        }
    }

    private fun onExtversion(payload: ByteArray, outgoing: MutableList<ByteArray>) {
        val advertised = try {
            extversionValue(payload, Net.BU_CAPD_VERSION)?.toInt() ?: 0
        } catch (_: WireException) {
            0
        }
        capd = advertised
        sendVerack(outgoing)
        noteText = if (advertised > 0) {
            "Peer advertised CAPD version $advertised."
        } else {
            "This peer did not advertise CAPD. New messages will not be relayed here."
        }
    }

    private fun onVerack(outgoing: MutableList<ByteArray>) {
        gotVerack = true
        if (!sentVerack) sendVerack(outgoing)
        if (sentVerack && !subscribed) subscribe(outgoing)
    }

    private fun sendVerack(outgoing: MutableList<ByteArray>) {
        if (sentVerack) return
        outgoing.add(send(Net.VERACK, ByteArray(0)))
        sentVerack = true
        if (gotVerack) subscribe(outgoing)
    }

    private fun subscribe(outgoing: MutableList<ByteArray>) {
        if (subscribed) return
        subscribed = true
        phaseName = "listening"
        outgoing.add(send(Net.CAPDGETINFO, ByteArray(0)))
        // An empty getmsg still sets the peer's send priority. Zero asks it to
        // inventory every CAPD message it is willing to gossip.
        outgoing.add(send(Net.CAPDGETMSG, encodeGetMsg(0.0, emptyList())))
        if (prefix.isNotEmpty()) outgoing.addAll(query(prefix))
        if (capd == 0) {
            noteText = "Connected. This peer is not advertising CAPD."
        } else if (prefix.isEmpty()) {
            noteText = "Connected. Relayed CAPD messages will show up while this screen is open."
        } else {
            noteText = "Connected. Asking for messages that start with ${hexEncode(prefix)}."
        }
    }

    private fun query(content: ByteArray): List<ByteArray> {
        val notify = encodeQuery(queryCookie, Net.QUERY_NOTIFY or Net.QUERY_MSG, 0, 200, content)
        val now = encodeQuery(queryCookie, Net.QUERY_MSG, 0, 200, content)
        return listOf(send(Net.CAPDQUERY, notify), send(Net.CAPDQUERY, now))
    }

    private fun onInfo(payload: ByteArray) {
        val info = decodeInfo(payload) ?: return
        pool = "local ${formatPriority(info.first)} · relay ${formatPriority(info.second)} · high ${formatPriority(info.third)}"
    }

    private fun onInv(payload: ByteArray, outgoing: MutableList<ByteArray>) {
        val hashes = try {
            decodeInv(payload)
        } catch (error: WireException) {
            noteText = error.message ?: "Could not read capdinv."
            return
        }
        val fresh = hashes.filter { seen.add(hexEncode(it)) }
        if (fresh.isNotEmpty()) outgoing.add(send(Net.CAPDGETMSG, encodeGetMsg(0.0, fresh)))
    }

    private fun onReply(
        payload: ByteArray,
        nowSeconds: Long,
        outgoing: MutableList<ByteArray>,
        found: MutableList<DecodedCapd>,
    ) {
        val reply = try {
            decodeQueryReply(payload, nowSeconds)
        } catch (error: WireException) {
            noteText = error.message ?: "Could not read a CAPD reply."
            return
        }
        if (reply.error != null) {
            noteText = "The peer rejected the CAPD query (${reply.error})."
            return
        }
        found.addAll(takeNew(reply.messages))
        val fresh = reply.hashes.filter { seen.add(hexEncode(it)) }
        if (fresh.isNotEmpty()) outgoing.add(send(Net.CAPDGETMSG, encodeGetMsg(0.0, fresh)))
    }

    private fun takeNew(messages: List<DecodedCapd>): List<DecodedCapd> {
        messages.forEach { seen.add(hexEncode(hexDecode(it.hash)!!.reversedArray())) }
        return messages
    }

    private fun send(command: String, payload: ByteArray, cookie: Long = nextCookie()): ByteArray {
        return frame(magic, command, cookie, payload)
    }

    private fun nextCookie(): Long {
        headerCookie = (headerCookie + 1) and 0xffffffffL
        return headerCookie
    }

    private fun step(send: List<ByteArray>, messages: List<DecodedCapd>) = PeerStep(
        send = send,
        messages = messages,
        phase = phaseName,
        note = noteText,
        capdVersion = capd,
        poolSummary = pool,
    )

    private class SplitMix(private var state: Long) {
        fun next(): Long {
            state += 0x9E3779B97F4A7C15uL.toLong()
            var z = state
            z = (z xor (z ushr 30)) * 0xBF58476D1CE4E5B9uL.toLong()
            z = (z xor (z ushr 27)) * 0x94D049BB133111EBuL.toLong()
            return z xor (z ushr 31)
        }
    }

    companion object {
        const val USER_AGENT = "/capd-chat:1.0/"
    }
}

class PeerStep(
    val send: List<ByteArray>,
    val messages: List<DecodedCapd>,
    val phase: String,
    val note: String,
    val capdVersion: Int,
    val poolSummary: String,
)

internal fun prefixBytes(hex: String): ByteArray? {
    if (hex.isBlank()) return ByteArray(0)
    val bytes = hexDecode(hex) ?: return null
    if (bytes.size != 2 && bytes.size != 4 && bytes.size != 8 && bytes.size != 16) return null
    return bytes
}

fun formatPriority(value: Double): String {
    if (!value.isFinite()) return "—"
    val abs = kotlin.math.abs(value)
    if (abs != 0.0 && (abs < 0.01 || abs >= 1_000_000.0)) return value.toString()
    val rounded = kotlin.math.round(value * 100.0) / 100.0
    val text = rounded.toString()
    return if (text.endsWith(".0")) text.dropLast(2) else text
}
