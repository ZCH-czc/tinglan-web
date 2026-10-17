package dev.tinglan.core

data class LyricLine(val timeMs: Long, val text: String)
data class LyricsDocument(val lines: List<LyricLine>, val synced: Boolean, val offsetMs: Long) {
    /** Last cue at or before position, O(log n), including multiple translations. */
    fun activeIndex(position: Long): Int {
        if (!synced) return -1
        var low = 0
        var high = lines.size - 1
        var result = -1
        while (low <= high) {
            val middle = low + (high - low) / 2
            if (lines[middle].timeMs <= position) { result = middle; low = middle + 1 } else high = middle - 1
        }
        return result
    }
}

object LyricsParser {
    const val MAX_TEXT = 200_000
    private val timestamp = Regex("\\[(\\d{1,5}):(\\d{2})(?:[.:](\\d{1,3}))?]")
    private val offsetTag = Regex("\\[offset:([+-]?\\d+)]", RegexOption.IGNORE_CASE)
    private val metadataTag = Regex("^\\[(?:ar|al|ti|by|re|ve|length|offset):.*]$", RegexOption.IGNORE_CASE)

    fun parse(raw: String): LyricsDocument {
        require(raw.length <= MAX_TEXT) { "Lyrics file is too large" }
        val input = raw.removePrefix("\uFEFF").replace("\r\n", "\n").replace('\r', '\n')
        val offset = offsetTag.find(input)?.groupValues?.get(1)?.toLongOrNull()?.coerceIn(-600_000, 600_000) ?: 0
        val timed = mutableListOf<LyricLine>()
        val plain = mutableListOf<LyricLine>()
        for (line in input.lines()) {
            val stamps = timestamp.findAll(line).toList()
            if (stamps.isNotEmpty()) {
                val content = timestamp.replace(line, "").trim()
                for (stamp in stamps) {
                    val minutes = stamp.groupValues[1].toLongOrNull() ?: continue
                    val seconds = stamp.groupValues[2].toIntOrNull() ?: continue
                    if (seconds > 59) continue
                    val fraction = stamp.groupValues[3].padEnd(3, '0').take(3).toLongOrNull() ?: 0
                    val time = (minutes * 60_000 + seconds * 1_000 + fraction + offset).coerceIn(0, MusicEngine.MAX_TIME)
                    if (content.isNotBlank()) timed.add(LyricLine(time, content))
                }
            } else if (line.isNotBlank() && !metadataTag.matches(line.trim())) plain.add(LyricLine(-1, line.trim()))
        }
        if (timed.isEmpty()) return LyricsDocument(plain, false, offset)
        // Combine original/translation at a timestamp; never drop either line.
        val combined = timed.sortedBy { it.timeMs }.groupBy { it.timeMs }.map { (time, cues) ->
            LyricLine(time, cues.map { it.text }.distinct().joinToString("\n"))
        }
        return LyricsDocument(combined, true, offset)
    }
}
