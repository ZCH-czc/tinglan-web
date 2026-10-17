package dev.tinglan.core

import kotlin.test.*

class LyricsParserTest {
    @Test fun parsesBomFractionsMetadataAndRepeatedTimestamps() {
        val doc = LyricsParser.parse("\uFEFF[ti:标题]\r\n[00:02.25][00:03.250]一句\r\n[00:00]开始")
        assertTrue(doc.synced); assertEquals(listOf(0L, 2250L, 3250L), doc.lines.map { it.timeMs })
        assertEquals("开始", doc.lines.first().text)
    }
    @Test fun mergesTranslationsWithoutDroppingThem() {
        val doc = LyricsParser.parse("[00:01]Original\n[00:01]翻译\n[00:01]Original")
        assertEquals("Original\n翻译", doc.lines.single().text)
    }
    @Test fun appliesSignedOffsetOnceAndClampsNegativeTime() {
        val doc = LyricsParser.parse("[offset:-500]\n[00:00.20]开头\n[00:01.50]随后")
        assertEquals(listOf(0L, 1000L), doc.lines.map { it.timeMs }); assertEquals(-500, doc.offsetMs)
    }
    @Test fun plainTextDoesNotPretendToBeSeekable() {
        val doc = LyricsParser.parse("[ar:作者]\n歌词第一句\n\n歌词第二句")
        assertFalse(doc.synced); assertEquals(2, doc.lines.size); assertEquals(-1, doc.activeIndex(2000))
    }
    @Test fun binarySearchIncludesZeroAndCorrectBoundary() {
        val doc = LyricsParser.parse("[00:01]一\n[00:02]二\n[00:03]三")
        assertEquals(-1, doc.activeIndex(999)); assertEquals(0, doc.activeIndex(1000))
        assertEquals(1, doc.activeIndex(2999)); assertEquals(2, doc.activeIndex(3000))
    }
    @Test fun ignoresInvalidSecondsAndLimitsInput() {
        assertFalse(LyricsParser.parse("[00:99]错误").synced)
        assertFailsWith<IllegalArgumentException> { LyricsParser.parse("a".repeat(LyricsParser.MAX_TEXT + 1)) }
    }
}
