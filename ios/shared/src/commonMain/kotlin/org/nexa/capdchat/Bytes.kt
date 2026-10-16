package org.nexa.capdchat

/** Little-endian writer for Nexa P2P payloads. */
internal class Buf {
    private val out = ArrayList<Byte>(64)

    fun u8(value: Int) {
        out.add((value and 0xff).toByte())
    }

    fun u16(value: Int) {
        u8(value)
        u8(value ushr 8)
    }

    fun u32(value: Long) {
        val v = value.toInt()
        u8(v)
        u8(v ushr 8)
        u8(v ushr 16)
        u8(v ushr 24)
    }

    fun u64(value: Long) {
        var v = value
        repeat(8) {
            out.add((v and 0xff).toByte())
            v = v ushr 8
        }
    }

    fun f64(value: Double) {
        u64(value.toRawBits())
    }

    fun u16be(value: Int) {
        u8(value ushr 8)
        u8(value)
    }

    fun bytes(value: ByteArray) {
        value.forEach { out.add(it) }
    }

    fun compact(value: ULong) {
        when {
            value < 253u -> u8(value.toInt())
            value <= 0xffffu -> {
                u8(0xfd)
                u16(value.toInt())
            }
            value <= 0xffffffffu -> {
                u8(0xfe)
                u32(value.toLong())
            }
            else -> {
                u8(0xff)
                u64(value.toLong())
            }
        }
    }

    fun vector(value: ByteArray) {
        compact(value.size.toULong())
        bytes(value)
    }

    fun toByteArray(): ByteArray = out.toByteArray()
}

internal class Reader(private val data: ByteArray) {
    var pos = 0
        private set

    fun remaining(): Int = data.size - pos

    fun u8(): Int {
        need(1)
        return data[pos++].toInt() and 0xff
    }

    fun u16(): Int = u8() or (u8() shl 8)

    fun u32(): Long {
        val b0 = u8().toLong()
        val b1 = u8().toLong()
        val b2 = u8().toLong()
        val b3 = u8().toLong()
        return b0 or (b1 shl 8) or (b2 shl 16) or (b3 shl 24)
    }

    fun u64(): Long {
        var value = 0L
        for (shift in 0 until 64 step 8) {
            value = value or (u8().toLong() shl shift)
        }
        return value
    }

    fun f64(): Double = Double.fromBits(u64())

    fun u16be(): Int = (u8() shl 8) or u8()

    fun bytes(count: Int): ByteArray {
        need(count)
        val slice = data.copyOfRange(pos, pos + count)
        pos += count
        return slice
    }

    fun skip(count: Int) {
        need(count)
        pos += count
    }

    fun skipVector(max: Int) {
        val size = compact()
        if (size > max.toULong()) throw WireException("vector of $size exceeds $max")
        skip(size.toInt())
    }

    fun compact(): ULong {
        val first = u8()
        return when {
            first < 253 -> first.toULong()
            first == 0xfd -> u16().toULong()
            first == 0xfe -> u32().toULong()
            else -> u64().toULong()
        }
    }

    fun vector(max: Int): ByteArray {
        val size = compact()
        if (size > max.toULong()) throw WireException("vector of $size exceeds $max")
        return bytes(size.toInt())
    }

    private fun need(count: Int) {
        if (remaining() < count) throw WireException("truncated message")
    }
}

internal class WireException(message: String) : Exception(message)

fun hexEncode(bytes: ByteArray): String {
    val chars = CharArray(bytes.size * 2)
    val alphabet = "0123456789abcdef"
    for (i in bytes.indices) {
        val value = bytes[i].toInt() and 0xff
        chars[i * 2] = alphabet[value ushr 4]
        chars[i * 2 + 1] = alphabet[value and 0x0f]
    }
    return chars.concatToString()
}

fun hexDecode(hex: String): ByteArray? {
    val clean = hex.trim().replace(" ", "")
    if (clean.length % 2 != 0) return null
    if (clean.any { it !in '0'..'9' && it !in 'a'..'f' && it !in 'A'..'F' }) return null
    val out = ByteArray(clean.length / 2)
    for (i in out.indices) {
        out[i] = clean.substring(i * 2, i * 2 + 2).toInt(16).toByte()
    }
    return out
}

internal fun reversedHex(bytes: ByteArray): String = hexEncode(bytes.reversedArray())

internal fun commandBytes(name: String): ByteArray {
    val out = ByteArray(12)
    val raw = name.encodeToByteArray()
    raw.copyInto(out, endIndex = minOf(12, raw.size))
    return out
}

internal fun commandName(bytes: ByteArray): String {
    val end = bytes.indexOf(0).let { if (it < 0) bytes.size else it }
    return bytes.copyOf(end).decodeToString()
}
