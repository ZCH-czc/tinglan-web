package dev.tinglan.core

/** Small, output-only JSON bridge; never inject imported filenames/lyrics into HTML. */
internal fun String.jsonString(): String = buildString {
    append('"')
    for (char in this@jsonString) when (char) {
        '"' -> append("\\\"")
        '\\' -> append("\\\\")
        '\n' -> append("\\n")
        '\r' -> append("\\r")
        '\t' -> append("\\t")
        else -> if (char.code < 32) append("\\u" + char.code.toString(16).padStart(4, '0')) else append(char)
    }
    append('"')
}
internal fun Track.json(): String = "{\"id\":${id.jsonString()},\"title\":${title.jsonString()},\"artist\":${artist.jsonString()},\"durationMs\":$durationMs,\"favorite\":$favorite}"
internal fun List<Track>.json(): String = joinToString(prefix = "[", postfix = "]") { it.json() }
internal fun QueuedTrack.json():String=track.json().dropLast(1)+",\"queueKey\":${key.jsonString()},\"queueIndex\":$index}"
internal fun LocalPlaylist.json(): String = "{\"id\":${id.jsonString()},\"name\":${name.jsonString()},\"trackIds\":" +
    trackIds.joinToString(prefix = "[", postfix = "]") { it.jsonString() } + ",\"createdAt\":$createdAt}"
internal fun LyricsDocument.json(): String = "{\"synced\":$synced,\"offsetMs\":$offsetMs,\"lines\":" +
    lines.joinToString(prefix = "[", postfix = "]") { "{\"timeMs\":${it.timeMs},\"text\":${it.text.jsonString()}}" } + "}"
