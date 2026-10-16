package org.nexa.capdchat

/** A CAPD message body, before archive fields are attached. */
data class CapdBody(
    val createTime: Long,
    val expiration: Int?,
    val rescind: ByteArray?,
    val data: ByteArray,
    val difficultyBits: Long,
    val nonce: ByteArray,
)

/**
 * One decoded pool message. `hash` matches Rostrum `capd.get` (reversed double-SHA256).
 * `expiration` is seconds after `created`, omitted when the node used 65535.
 */
data class DecodedCapd(
    val hash: String,
    val created: Long,
    val expiration: Int?,
    val difficultyBits: Long,
    val priority: Double,
    val initialPriority: Double,
    val powTarget: String,
    val nonce: String,
    val size: Int,
    val data: String,
    val text: String?,
    val rescind: String? = null,
)

internal object Net {
    const val PROTOCOL_VERSION = 80008
    const val NODE_EXTVERSION = 1L shl 11
    const val HEADER_SIZE = 24
    const val MAX_PAYLOAD = 2 * 1024 * 1024
    const val MAX_PING = 8
    const val CAPD_MSG_TYPE = 72
    const val QUERY_MSG = 1
    const val QUERY_HASH = 2
    const val QUERY_ERROR = 3
    const val QUERY_NOTIFY = 0x80
    /** Node cap on a capdqreply of full messages (`CAPD_QUERY_MAX_MSGS`). */
    const val QUERY_MAX_MSGS = 200
    /** Node cap on a capdqreply of hashes (`CAPD_QUERY_MAX_INVS`). */
    const val QUERY_MAX_HASHES = 2000
    /** Smallest CapdMsg on the wire: fields, time, bits, empty nonce, empty data. */
    const val MIN_CAPD_MSG = 15
    const val HANDSHAKE_TIMEOUT_SEC = 20L
    const val IDLE_PING_SEC = 120L
    const val IDLE_TIMEOUT_SEC = 300L
    const val MAX_PARSE_FAILURES = 3
    const val EXT_VERSION_KEY = 0uL
    const val EXT_VERSION_VALUE = 100uL
    const val BU_IGNORE_CHECKSUM = 0x0000000200000002uL
    const val BU_CAPD_VERSION = 0x000000020000000euL
    val MAINNET_MAGIC = byteArrayOf(0x72, 0x27, 0x12, 0x21)
    val TESTNET_MAGIC = byteArrayOf(0x72, 0x27, 0x12, 0x22)

    const val VERSION = "version"
    const val VERACK = "verack"
    const val PING = "ping"
    const val PONG = "pong"
    const val EXTVERSION = "extversion"
    const val CAPDINV = "capdinv"
    const val CAPDGETMSG = "capdgetmsg"
    const val CAPDMSG = "capdmsg"
    const val CAPDGETINFO = "capdgetinfo"
    const val CAPDINFO = "capdinfo"
    const val CAPDQUERY = "capdq"
    const val CAPDQREPLY = "capdqreply"
    const val CAPDREMOVE = "capdremove"
    const val REJECT = "reject"
}

/**
 * Client-side safety limits and local policy. These are tighter than the node
 * (capdinv 20000, capdmsg 5000, data up to GetMaxAllowedNetMessage) and are not protocol rules.
 */
internal object ClientLimits {
    const val MAX_INV = 2000
    const val MAX_MSG_VECTOR = 500
    const val MAX_CAPD_DATA = 64 * 1024
    const val MAX_FUTURE_SEC = 120L
    /** The node's `MIN_LOCAL_PRIORITY` with an empty pool. */
    const val MIN_PRIORITY = 1.0
}

internal data class Frame(val command: String, val cookie: Long, val payload: ByteArray)

internal fun magicFor(network: String): ByteArray = when (network) {
    "mainnet" -> Net.MAINNET_MAGIC
    "testnet" -> Net.TESTNET_MAGIC
    else -> throw WireException("unknown network $network")
}

internal fun frame(magic: ByteArray, command: String, cookie: Long, payload: ByteArray): ByteArray {
    val out = Buf()
    out.bytes(magic)
    out.bytes(commandBytes(command))
    out.u32(payload.size.toLong())
    out.u32(cookie)
    out.bytes(payload)
    return out.toByteArray()
}

internal class FrameParser(private val magic: ByteArray) {
    private var pending = ByteArray(0)

    fun push(chunk: ByteArray): List<Frame> {
        if (chunk.isEmpty()) return emptyList()
        pending = pending + chunk
        val frames = ArrayList<Frame>()
        while (pending.size >= Net.HEADER_SIZE) {
            if (!pending.copyOfRange(0, 4).contentEquals(magic)) {
                throw WireException("message did not start with the ${hexEncode(magic)} network magic")
            }
            val reader = Reader(pending)
            reader.bytes(4)
            val command = commandName(reader.bytes(12))
            val length = reader.u32()
            val cookie = reader.u32()
            if (length < 0 || length > Net.MAX_PAYLOAD) throw WireException("message length $length is not usable")
            val total = Net.HEADER_SIZE + length.toInt()
            if (pending.size < total) break
            val payload = pending.copyOfRange(Net.HEADER_SIZE, total)
            frames.add(Frame(command, cookie, payload))
            pending = pending.copyOfRange(total, pending.size)
        }
        return frames
    }
}

internal fun encodeVersion(
    services: Long,
    nowSeconds: Long,
    peerPort: Int,
    nonce: Long,
    userAgent: String,
    startHeight: Long,
    relay: Boolean,
): ByteArray {
    val agent = userAgent.encodeToByteArray()
    return Buf().apply {
        u32(Net.PROTOCOL_VERSION.toLong())
        u64(services)
        u64(nowSeconds)
        address(0, peerPort)
        address(services, 0)
        u64(nonce)
        vector(agent)
        u32(startHeight)
        u8(if (relay) 1 else 0)
    }.toByteArray()
}

private fun Buf.address(services: Long, port: Int) {
    u64(services)
    bytes(ByteArray(10))
    u8(0xff)
    u8(0xff)
    bytes(ByteArray(4))
    u16be(port)
}

internal fun versionServices(payload: ByteArray): Long {
    val reader = Reader(payload)
    reader.u32()
    return reader.u64()
}

internal fun encodeExtversion(entries: Map<ULong, ULong>): ByteArray {
    // std::map sends keys in ascending order. toSortedMap is JVM-only.
    val ordered = entries.keys.sorted()
    return Buf().apply {
        compact(ordered.size.toULong())
        for (key in ordered) {
            compact(key)
            val packed = Buf().apply { compact(entries.getValue(key)) }.toByteArray()
            vector(packed)
        }
    }.toByteArray()
}

internal fun extversionValue(payload: ByteArray, key: ULong): ULong? {
    val reader = Reader(payload)
    val count = reader.compact()
    var seen = 0uL
    var found: ULong? = null
    while (seen < count && reader.remaining() > 0) {
        val entryKey = reader.compact()
        val raw = reader.vector(64)
        if (entryKey == key && raw.isNotEmpty()) {
            found = Reader(raw).compact()
        }
        seen++
    }
    return found
}

internal fun encodeCapd(message: CapdBody): ByteArray = Buf().apply {
    var fields = 0
    if (message.expiration != null && message.expiration != NEVER_EXPIRE) fields = fields or 1
    if (message.rescind != null && !message.rescind.all { it == 0.toByte() }) fields = fields or 2
    u8(fields)
    u64(message.createTime)
    u32(message.difficultyBits.toLong())
    vector(message.nonce)
    if (fields and 1 != 0) u16(message.expiration ?: NEVER_EXPIRE)
    if (fields and 2 != 0) bytes(message.rescind ?: ByteArray(20))
    vector(message.data)
}.toByteArray()

internal fun decodeCapd(reader: Reader, nowSeconds: Long): DecodedCapd {
    val fields = reader.u8()
    if (fields and 3.inv() != 0) throw WireException("unknown CAPD fields $fields")
    val created = reader.u64()
    val bits = reader.u32()
    val nonce = reader.vector(64)
    val expiration = if (fields and 1 != 0) reader.u16() else NEVER_EXPIRE
    val rescind = if (fields and 2 != 0) reader.bytes(20) else null
    val data = reader.vector(ClientLimits.MAX_CAPD_DATA)
    val body = CapdBody(
        createTime = created,
        expiration = if (expiration == NEVER_EXPIRE) null else expiration,
        rescind = rescind,
        data = data,
        difficultyBits = bits,
        nonce = nonce,
    )
    val age = nowSeconds - created
    return DecodedCapd(
        hash = capdHash(body),
        created = created,
        expiration = body.expiration,
        difficultyBits = bits,
        priority = capdPriority(bits, data.size, age),
        initialPriority = capdPriority(bits, data.size, 0),
        powTarget = compactTargetHex(bits),
        nonce = hexEncode(nonce),
        size = data.size,
        data = hexEncode(data),
        text = decodePayload(data),
        rescind = rescind?.let { hexEncode(it) },
    )
}

internal fun decodeCapdVector(payload: ByteArray, nowSeconds: Long): List<DecodedCapd> {
    val reader = Reader(payload)
    val count = boundedCount(reader.compact(), ClientLimits.MAX_MSG_VECTOR, reader.remaining(), Net.MIN_CAPD_MSG)
    return List(count) { decodeCapd(reader, nowSeconds) }
}

internal fun encodeQuery(cookie: Long, type: Int, start: Long, quantity: Long, content: ByteArray): ByteArray =
    Buf().apply {
        u32(cookie)
        u8(type)
        u32(start)
        u32(quantity)
        vector(content)
    }.toByteArray()

internal fun encodeGetMsg(priority: Double, hashes: List<ByteArray>): ByteArray = Buf().apply {
    f64(priority)
    compact(hashes.size.toULong())
    hashes.forEach { bytes(it) }
}.toByteArray()

internal data class QueryReply(
    val cookie: Long,
    val type: Int,
    val messages: List<DecodedCapd>,
    val hashes: List<ByteArray>,
    val error: Int?,
)

internal fun decodeQueryReply(payload: ByteArray, nowSeconds: Long): QueryReply {
    val reader = Reader(payload)
    val cookie = reader.u32()
    val type = reader.u8()
    if ((type and 0x7f) == Net.QUERY_ERROR) {
        val error = if (reader.remaining() > 0) reader.u8() else 0
        return QueryReply(cookie, type, emptyList(), emptyList(), error)
    }
    if (reader.remaining() < 4) return QueryReply(cookie, type, emptyList(), emptyList(), null)
    reader.u32()
    val kind = type and 0x7f
    return when (kind) {
        Net.QUERY_HASH -> {
            val count = boundedCount(reader.compact(), Net.QUERY_MAX_HASHES, reader.remaining(), 32)
            val hashes = ArrayList<ByteArray>(count)
            repeat(count) { hashes.add(reader.bytes(32)) }
            QueryReply(cookie, type, emptyList(), hashes, null)
        }
        else -> {
            val count = if (reader.remaining() == 0) {
                0
            } else {
                boundedCount(reader.compact(), Net.QUERY_MAX_MSGS, reader.remaining(), Net.MIN_CAPD_MSG)
            }
            val messages = ArrayList<DecodedCapd>(count)
            repeat(count) { messages.add(decodeCapd(reader, nowSeconds)) }
            QueryReply(cookie, type, messages, emptyList(), null)
        }
    }
}

/**
 * A peer-supplied count is only turned into a list after it is within the
 * protocol maximum and the bytes still in the frame can hold that many items.
 * `List(count.toInt())` on a raw compact size will allocate before either check,
 * and a size above [Int.MAX_VALUE] becomes a negative [Int].
 */
internal fun boundedCount(count: ULong, max: Int, remaining: Int, stride: Int): Int {
    if (count > max.toULong()) throw WireException("count $count exceeds $max")
    val room = if (remaining <= 0) 0L else remaining.toLong() / stride.toLong()
    if (count > room.toULong()) throw WireException("count $count does not fit in $remaining bytes")
    return count.toInt()
}

internal fun decodeInv(payload: ByteArray): List<ByteArray> {
    val reader = Reader(payload)
    val type = reader.compact()
    if (type != Net.CAPD_MSG_TYPE.toULong()) return emptyList()
    val count = boundedCount(reader.compact(), ClientLimits.MAX_INV, reader.remaining(), 32)
    return List(count) { reader.bytes(32) }
}

/** `CapdMsg::DoesPowMeetTarget`: the hash recomputed from the body is strictly below the target. */
internal fun powMeetsTarget(body: CapdBody, hash: String): Boolean {
    val actual = capdHash(body)
    return actual == hash.lowercase() && actual < compactTargetHex(body.difficultyBits)
}

/** Local policy: size, minimum priority, not future-dated, not past its expiration. */
internal fun withinClientLimits(bits: Long, created: Long, expiration: Int?, size: Int, nowSeconds: Long): Boolean {
    if (size < 0 || size > ClientLimits.MAX_CAPD_DATA) return false
    if (capdPriority(bits, size, 0) < ClientLimits.MIN_PRIORITY) return false
    if (created > nowSeconds + ClientLimits.MAX_FUTURE_SEC) return false
    return expiration == null || created + expiration >= nowSeconds
}

internal fun capdAcceptable(
    hash: String,
    bits: Long,
    created: Long,
    expiration: Int?,
    rescindHex: String?,
    dataHex: String,
    nonceHex: String,
    nowSeconds: Long,
    kept: Boolean = false,
): Boolean {
    val data = hexDecode(dataHex) ?: return false
    val nonce = hexDecode(nonceHex) ?: return false
    val rescind = rescindHex?.let { hexDecode(it)?.takeIf { r -> r.size == 20 } ?: return false }
    if (!withinClientLimits(bits, created, if (kept) null else expiration, data.size, nowSeconds)) return false
    return powMeetsTarget(CapdBody(created, expiration, rescind, data, bits, nonce), hash)
}

internal fun DecodedCapd.acceptable(nowSeconds: Long) =
    size == data.length / 2 && capdAcceptable(hash, difficultyBits, created, expiration, rescind, data, nonce, nowSeconds)

internal fun decodeInfo(payload: ByteArray): Triple<Double, Double, Double>? {
    if (payload.size < 24) return null
    val reader = Reader(payload)
    return Triple(reader.f64(), reader.f64(), reader.f64())
}

internal fun rejectReason(payload: ByteArray): String {
    return try {
        val reader = Reader(payload)
        val command = reader.vector(32).decodeToString()
        val code = reader.u8()
        val reason = reader.vector(256).decodeToString()
        "$command ($code): $reason"
    } catch (_: Exception) {
        "peer rejected a message"
    }
}
