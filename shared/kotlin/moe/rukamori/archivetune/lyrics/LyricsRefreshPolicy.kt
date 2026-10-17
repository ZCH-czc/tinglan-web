package moe.rukamori.archivetune.lyrics

/** The highlighted line only needs an update at its next boundary or after a seek. */
internal fun lyricsLineRefreshDelay(positionMs: Long, nextLineMs: Long?, speed: Float): Long {
    val playbackSpeed = speed.takeIf { it.isFinite() && it > 0f } ?: 1f
    val remaining = nextLineMs?.let { (it - positionMs).coerceAtLeast(0L) }
        ?: return 1_000L
    return (remaining / playbackSpeed).toLong().coerceIn(16L, 1_000L)
}
