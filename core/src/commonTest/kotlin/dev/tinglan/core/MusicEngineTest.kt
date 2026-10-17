package dev.tinglan.core

import kotlin.test.*

class MusicEngineTest {
    @Test fun importedMetadataPreservesPlaybackAndDoesNotCreateAnImplicitQueue() {
        val engine=MusicEngine()
        assertTrue(engine.upsert("imported","歌单歌曲","歌手",60_000.0,false,enqueue=false))
        assertNull(engine.currentId);assertEquals(emptyList(),engine.queuedIds())
        engine.upsert("current","正在播放","歌手",120_000.0,true);engine.setPosition(20_000.0)
        engine.upsert("more","更多歌曲","歌手",60_000.0,false,enqueue=false)
        assertEquals("current",engine.currentId);assertEquals(20_000,engine.positionMs);assertEquals(listOf("current"),engine.queuedIds())
    }
    @Test fun releasingCatalogMetadataProtectsPlaybackSavedSongsAndPlaylists() {
        val engine=MusicEngine()
        listOf("saved","queued","playlist","orphan").forEach {engine.upsert(it,it,"歌手",60_000.0,false,enqueue=false);engine.setLyrics(it,"[00:01]保留歌词")}
        engine.setQueue(listOf("queued"));engine.setPosition(5000.0);engine.playlists.upsert("p","歌单",listOf("playlist"),1.0)
        assertEquals(1,engine.releaseUnretained(setOf("saved")))
        assertEquals(setOf("saved","queued","playlist"),engine.library().map {it.id}.toSet());assertEquals("queued",engine.currentId);assertEquals(5000,engine.positionMs)
        assertEquals("保留歌词",engine.lyrics("playlist").lines.first().text)
    }
    private fun populated(): MusicEngine = MusicEngine().apply {
        upsert("a", "第一首", "听岚", 60_000.0, false)
        upsert("b", "Second", "Artist", 120_000.0, false)
        upsert("c", "第三首", "听岚", 10_000.0, true)
    }
    @Test fun updatingMetadataDoesNotDuplicateQueue() {
        val engine = populated()
        engine.upsert("a", "新名称", "歌手", 60_000.0, true)
        assertEquals(listOf("a", "b", "c"), engine.queuedTracks().map { it.id })
        assertEquals("新名称", engine.currentTrack()?.title)
    }
    @Test fun removingCurrentSelectsNearestAndClearsPosition() {
        val engine = populated()
        engine.select("b"); engine.setPosition(20_000.0); engine.remove("b")
        assertEquals("c", engine.currentId); assertEquals(0, engine.positionMs)
        engine.remove("c"); assertEquals("a", engine.currentId)
        engine.remove("a"); assertNull(engine.currentId); assertNull(engine.next(true))
    }
    @Test fun automaticEndStopsButManualSkipWraps() {
        val engine = populated(); engine.select("c")
        assertNull(engine.next(true)); assertEquals("c", engine.currentId)
        assertEquals("a", engine.next(false))
        engine.repeatMode = RepeatMode.ALL; engine.select("c")
        assertEquals("a", engine.next(true))
    }
    @Test fun repeatOneDoesNotTrapManualSkip() {
        val engine = populated(); engine.repeatMode = RepeatMode.ONE
        engine.setPosition(5000.0); assertEquals("a", engine.next(true)); assertEquals(0, engine.positionMs)
        assertEquals("b", engine.next(false))
    }
    @Test fun previousRestartsAfterThreeSeconds() {
        val engine = populated(); engine.select("b"); engine.setPosition(3001.0)
        assertEquals("b", engine.previous()); assertEquals("a", engine.previous())
    }
    @Test fun positionsAreFiniteNonnegativeAndBounded() {
        val engine = populated()
        assertEquals(0, engine.setPosition(Double.NaN)); assertEquals(0, engine.setPosition(-15.0))
        assertEquals(60_000, engine.setPosition(1e100)); assertEquals(0, engine.setPosition(Double.POSITIVE_INFINITY))
    }
    @Test fun searchMatchesArtistsAndFavorites() {
        val engine = populated()
        assertEquals(2, engine.library(" 听岚 ").size)
        assertEquals("b", engine.library("SECOND").single().id)
        assertEquals("c", engine.library("", true).single().id)
    }
    @Test fun reorderPreservesCurrentAndRejectsInvalidIndices() {
        val engine = populated(); engine.select("b")
        assertFalse(engine.move("a", 99)); assertFalse(engine.select("absent"))
        assertTrue(engine.move("c", 0)); assertEquals("b", engine.currentId)
        assertEquals(listOf("c", "a", "b"), engine.queuedTracks().map { it.id })
    }
    @Test fun lyricSeekUsesSharedAndroidPolicyAndBounds() {
        val engine = populated()
        engine.setLyrics("a", "[00:00]开始\n[01:30]结束")
        assertEquals(0, engine.lyricSeek("a", 0)); assertEquals(60_000, engine.lyricSeek("a", 1))
        assertNull(engine.lyricSeek("a", 7)); engine.setLyrics("a", "纯文本"); assertNull(engine.lyricSeek("a", 0))
    }
    @Test fun sharedRefreshPolicyHandlesInvalidSpeed() {
        val engine = populated(); engine.setLyrics("a", "[00:00]开始\n[00:02]下一句")
        assertEquals(500, engine.lyricRefreshDelay("a", 1500.0, Float.NaN))
        assertEquals(250, engine.lyricRefreshDelay("a", 1500.0, 2f))
    }
    @Test fun rapidSkipsKeepQueueAndCurrentValid() {
        val engine = populated()
        repeat(10_000) { engine.next(false); engine.previous() }
        assertEquals(3, engine.queuedTracks().size); assertNotNull(engine.currentTrack())
    }
    @Test fun jsonEscapesUntrustedContent() {
        val engine = MusicEngine(); engine.upsert("a", "\"<script>\n\\", "\u0001", 0.0, false)
        val json = engine.library().json()
        assertTrue(json.contains("\\\"<script>\\n\\\\")); assertTrue(json.contains("\\u0001"))
    }
}
