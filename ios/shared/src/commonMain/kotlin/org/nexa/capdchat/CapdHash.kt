package org.nexa.capdchat

/**
 * CAPD identity, matching `CapdMsg::CalcHash` in nexa `src/capd/capdmsg.cpp`.
 *
 * The preimage is the SER_GETHASH form: compact data, createTime, a 20-byte
 * rescind hash (zeros when unset), expiration (65535 when unset), difficultyBits.
 * The id is SHA256(SHA256(SHA256(preimage) || nonce)). Display hex reverses
 * those 32 bytes, which is how `uint256::GetHex` and Rostrum present it.
 */
internal fun capdHash(message: CapdBody): String {
    val stage1 = Sha256.hash(hashPreimage(message))
    val second = Buf().apply {
        bytes(stage1)
        bytes(message.nonce)
    }.toByteArray()
    return reversedHex(Sha256.hashTwice(second))
}

internal fun hashPreimage(message: CapdBody): ByteArray = Buf().apply {
    vector(message.data)
    u64(message.createTime)
    bytes(message.rescind ?: ByteArray(20))
    u16(message.expiration ?: NEVER_EXPIRE)
    u32(message.difficultyBits.toLong())
}.toByteArray()

/**
 * Bitcoin compact target, expanded to the 32-byte form `uint256::GetHex` prints.
 * The sign bit is treated as an empty target.
 */
fun compactTargetHex(bits: Long): String {
    val compact = bits.toInt()
    if (compact and 0x00800000 != 0) return "00".repeat(32)
    val size = compact ushr 24
    val word = compact and 0x007fffff
    val raw = ByteArray(32)
    if (word != 0 && size in 1..32) {
        val shifted = if (size <= 3) word ushr (8 * (3 - size)) else word
        val start = if (size <= 3) 0 else size - 3
        var value = shifted
        var index = start
        repeat(3) {
            if (index in raw.indices) raw[index] = (value and 0xff).toByte()
            value = value ushr 8
            index += 1
        }
    }
    return reversedHex(raw)
}

/**
 * Node priority from `Priority()` in capdmsg.cpp. Age is clamped at zero when
 * the message is dated in the future. The minimum difficulty is 2^248, which
 * is the double the node gets from the 248-bit minimum target.
 */
fun capdPriority(bits: Long, contentLength: Int, ageSeconds: Long): Double {
    val target = compactTargetDouble(bits)
    if (target <= 0.0 || !target.isFinite()) return 0.0
    var value = MIN_DIFFICULTY_DOUBLE / target
    if (contentLength > NOMINAL_MSG_SIZE) {
        value = (value / contentLength) * NOMINAL_MSG_SIZE
    }
    val age = if (ageSeconds < 0) 0 else ageSeconds
    value -= (value / MSG_LIFETIME_SEC) * age
    return value
}

private fun compactTargetDouble(bits: Long): Double {
    val compact = bits.toInt()
    if (compact and 0x00800000 != 0) return 0.0
    val size = compact ushr 24
    val word = (compact and 0x007fffff).toDouble()
    if (word == 0.0) return 0.0
    val shift = 8.0 * (size - 3)
    return word * 2.0.raisedTo(shift)
}

private fun Double.raisedTo(exponent: Double): Double {
    if (exponent == 0.0) return 1.0
    val bits = exponent.toInt()
    if (bits.toDouble() == exponent && bits >= 0 && bits < 1023) {
        var result = 1.0
        var base = this
        var exp = bits
        while (exp > 0) {
            if (exp and 1 == 1) result *= base
            base *= base
            exp = exp ushr 1
        }
        return result
    }
    return kotlin.math.exp(exponent * kotlin.math.ln(this))
}

internal const val NEVER_EXPIRE = 65535
private const val NOMINAL_MSG_SIZE = 100
private const val MSG_LIFETIME_SEC = 600.0
private val MIN_DIFFICULTY_DOUBLE = 2.0.raisedTo(248.0)
