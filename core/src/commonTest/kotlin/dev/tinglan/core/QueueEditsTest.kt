package dev.tinglan.core

import kotlin.test.*

class QueueEditsTest {
    @Test fun dequeuePreservesLibraryLyricsAndPlaylist() {
        val engine = MusicEngine()
        engine.upsert("a", "歌曲 A", "听岚", 60000.0, true)
        engine.upsert("b", "歌曲 B", "听岚", 60000.0, false)
        engine.setLyrics("a", "[00:00.00]保留歌词")
        engine.playlists.upsert("p", "保留歌单", listOf("a", "b"), 0.0)
        engine.select("a"); engine.setPosition(9000.0)
        assertTrue(engine.dequeue("b"))
        assertEquals("a", engine.currentId); assertEquals(9000L, engine.positionMs)
        assertTrue(engine.dequeue("a")); assertNull(engine.currentId)
        assertEquals(2, engine.library().size)
        assertEquals("保留歌词", engine.lyrics("a").lines.first().text)
        assertEquals(listOf("a", "b"), engine.playlists.get("p")?.trackIds)
        engine.upsert("c", "歌曲 C", "听岚", 0.0, false)
        assertTrue(engine.queuedTracks().isEmpty())
    }
    @Test fun currentRemovalSelectsAnAdjacentSongAndClearKeepsLibrary() {
        val engine = MusicEngine()
        listOf("a", "b", "c").forEach { engine.upsert(it, it, "听岚", 10000.0, false) }
        engine.select("b"); engine.setPosition(5000.0)
        assertTrue(engine.dequeue("b")); assertEquals("c", engine.currentId)
        assertEquals(0L, engine.positionMs)
        engine.clearQueue(); assertNull(engine.currentId); assertEquals(3, engine.library().size)
        assertTrue(engine.select("a")); assertTrue(engine.setQueue(listOf("a", "c")))
        assertFalse(engine.dequeue("unknown")); assertEquals("a", engine.currentId)
    }
}
