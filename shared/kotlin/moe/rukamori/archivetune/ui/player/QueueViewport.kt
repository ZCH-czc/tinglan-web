package moe.rukamori.archivetune.ui.player

/** Scroll delta in the list's coordinate space, excluding its bottom system padding. */
internal fun queueCenterScrollDelta(
    itemOffset: Int,
    itemSize: Int,
    viewportStart: Int,
    viewportEnd: Int,
    beforePadding: Int,
    afterPadding: Int,
): Float {
    val start = viewportStart.toLong() + beforePadding.coerceAtLeast(0)
    val end = viewportEnd.toLong() - afterPadding.coerceAtLeast(0)
    if (itemSize <= 0 || end <= start) return 0f
    return (itemOffset.toDouble() + itemSize / 2.0 - (start + end) / 2.0).toFloat()
}
