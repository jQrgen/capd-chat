package org.nexa.capdchat

/**
 * Same readable-text rule as the website: strict UTF-8, and C0 controls other
 * than tab, LF, and CR stay on the hex path.
 */
fun decodePayload(bytes: ByteArray): String? {
    val text = decodeUtf8(bytes) ?: return null
    if (!isReadable(text)) return null
    return text
}

internal fun isReadable(text: String): Boolean {
    var i = 0
    while (i < text.length) {
        val code = text.codePointAt(i)
        if (code != 0x09 && code != 0x0a && code != 0x0d && (code < 0x20 || code == 0x7f)) return false
        i += if (code > 0xffff) 2 else 1
    }
    return true
}

private fun String.codePointAt(index: Int): Int {
    val first = this[index].code
    if (first in 0xD800..0xDBFF && index + 1 < length) {
        val second = this[index + 1].code
        if (second in 0xDC00..0xDFFF) {
            return 0x10000 + ((first - 0xD800) shl 10) + (second - 0xDC00)
        }
    }
    return first
}

internal fun decodeUtf8(bytes: ByteArray): String? {
    val out = StringBuilder()
    var i = 0
    while (i < bytes.size) {
        val b0 = bytes[i].toInt() and 0xff
        when {
            b0 <= 0x7f -> {
                out.append(b0.toChar())
                i += 1
            }
            b0 in 0xc2..0xdf -> {
                if (i + 1 >= bytes.size) return null
                val b1 = bytes[i + 1].toInt() and 0xff
                if (b1 !in 0x80..0xbf) return null
                out.append(((b0 and 0x1f) shl 6 or (b1 and 0x3f)).toChar())
                i += 2
            }
            b0 in 0xe0..0xef -> {
                if (i + 2 >= bytes.size) return null
                val b1 = bytes[i + 1].toInt() and 0xff
                val b2 = bytes[i + 2].toInt() and 0xff
                if (b1 !in 0x80..0xbf || b2 !in 0x80..0xbf) return null
                if (b0 == 0xe0 && b1 < 0xa0) return null
                if (b0 == 0xed && b1 >= 0xa0) return null
                val code = (b0 and 0x0f) shl 12 or (b1 and 0x3f) shl 6 or (b2 and 0x3f)
                out.append(code.toChar())
                i += 3
            }
            b0 in 0xf0..0xf4 -> {
                if (i + 3 >= bytes.size) return null
                val b1 = bytes[i + 1].toInt() and 0xff
                val b2 = bytes[i + 2].toInt() and 0xff
                val b3 = bytes[i + 3].toInt() and 0xff
                if (b1 !in 0x80..0xbf || b2 !in 0x80..0xbf || b3 !in 0x80..0xbf) return null
                if (b0 == 0xf0 && b1 < 0x90) return null
                if (b0 == 0xf4 && b1 >= 0x90) return null
                val code = (b0 and 0x07) shl 18 or (b1 and 0x3f) shl 12 or (b2 and 0x3f) shl 6 or (b3 and 0x3f)
                if (code > 0x10ffff) return null
                val shifted = code - 0x10000
                out.append(((shifted ushr 10) + 0xD800).toChar())
                out.append(((shifted and 0x3ff) + 0xDC00).toChar())
                i += 4
            }
            else -> return null
        }
    }
    return out.toString()
}
