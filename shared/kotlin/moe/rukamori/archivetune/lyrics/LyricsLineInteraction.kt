package moe.rukamori.archivetune.lyrics

/** Display uses position + user offset; seeking must apply the inverse offset.
 * Zero is a real timestamp. Plain text and negative sentinel timestamps cannot seek.
 */
object LyricsLineInteraction {
    fun seekPosition(timeMs: Long, synced: Boolean, offsetMs: Int, durationMs: Long): Long? {
        if (!synced || timeMs < 0) return null
        val offset = offsetMs.toLong()
        val target = if (offset < 0 && timeMs > Long.MAX_VALUE + offset) Long.MAX_VALUE else timeMs - offset
        return target.coerceIn(0L, durationMs.takeIf { it > 0 } ?: Long.MAX_VALUE)
    }

    fun copyText(text: String): String? = text.trim().takeIf { it.isNotEmpty() }
}
