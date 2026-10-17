package dev.tinglan.core

import kotlin.test.*

class PlaylistsTest {
    private fun engine() = MusicEngine().apply {
        listOf("a", "b", "c").forEach { upsert(it, it, "听岚", 60_000.0, false) }
    }
    @Test fun membershipPreservesOrderAndRejectsDuplicates() {
        val engine = engine()
        assertTrue(engine.playlists.upsert("p", "  夜航  ", listOf("b", "a"), 1.0))
        assertEquals("夜航", engine.playlists.get("p")?.name)
        assertFalse(engine.playlists.upsert("p", "坏数据", listOf("a", "a"), 1.0))
        assertEquals(listOf("b", "a"), engine.playlists.get("p")?.trackIds)
    }
    @Test fun invalidReferencesAndNamesLeavePreviousPlaylistIntact() {
        val engine = engine()
        engine.playlists.upsert("p", "夜航", listOf("a"), 1.0)
        assertFalse(engine.playlists.upsert("p", "夜航", listOf("missing"), 1.0))
        assertFalse(engine.playlists.upsert("p", " ", emptyList(), 1.0))
        assertFalse(engine.playlists.upsert("p", "a".repeat(81), emptyList(), 1.0))
        assertEquals(listOf("a"), engine.playlists.get("p")?.trackIds)
    }
    @Test fun addingAlreadyPresentSongIsIdempotent() {
        val engine = engine()
        engine.playlists.upsert("p", "夜航", emptyList(), 1.0)
        repeat(20) { assertTrue(engine.playlists.add("p", "a")) }
        assertEquals(listOf("a"), engine.playlists.get("p")?.trackIds)
    }
    @Test fun removingPlaylistSongPreservesLibraryAndOtherMemberships() {
        val engine = engine()
        for (id in listOf("p", "q")) engine.playlists.upsert(id, id, listOf("a", "b"), 1.0)
        engine.playlists.removeSong("p", "a")
        assertEquals(3, engine.library().size)
        assertEquals(listOf("a", "b"), engine.playlists.get("q")?.trackIds)
        assertEquals(listOf("b"), engine.playlists.get("p")?.trackIds)
    }
    @Test fun removingLibraryTrackCleansEveryPlaylist() {
        val engine = engine()
        for (id in listOf("p", "q")) engine.playlists.upsert(id, id, listOf("a", "b"), 1.0)
        engine.remove("a")
        assertTrue(engine.playlists.all().all { it.trackIds == listOf("b") })
    }
    @Test fun playlistCapacityAllowsRenameButNotAnotherPlaylist() {
        val engine = engine()
        repeat(200) { assertTrue(engine.playlists.upsert("p$it", "歌单", emptyList(), it.toDouble())) }
        assertFalse(engine.playlists.upsert("overflow", "歌单", emptyList(), 201.0))
        assertTrue(engine.playlists.upsert("p1", "新名字", listOf("a"), 1.0))
        assertEquals(200, engine.playlists.all().size)
    }
    @Test fun contextualQueueNeverAdvancesIntoUnrelatedLibrary() {
        val engine = engine()
        assertTrue(engine.setQueue(listOf("b", "a")))
        assertEquals("a", engine.currentId)
        engine.select("b")
        assertEquals("a", engine.next(true))
        assertNull(engine.next(true))
        assertEquals(listOf("b", "a"), engine.queuedTracks().map { it.id })
    }
    @Test fun invalidQueueReplacementIsAtomic() {
        val engine = engine(); engine.select("b"); engine.setPosition(5000.0)
        assertFalse(engine.setQueue(listOf("a", "missing")))
        assertFalse(engine.setQueue(listOf("a", "a"),2))
        assertFalse(engine.setQueue(emptyList()))
        assertEquals("b", engine.currentId); assertEquals(5000L, engine.positionMs)
        assertEquals(listOf("a", "b", "c"), engine.queuedTracks().map { it.id })
    }
    @Test fun importingAndUpdatingMetadataDoNotExpandExplicitQueue() {
        val engine = engine(); engine.setQueue(listOf("a"))
        engine.upsert("d", "新歌曲", "听岚", 1.0, false)
        engine.upsert("c", "新信息", "听岚", 2.0, true)
        assertEquals(listOf("a"), engine.queuedTracks().map { it.id })
        assertEquals(4, engine.library().size)
    }
    @Test fun deletingPlaylistDoesNotDeleteMusic() {
        val engine = engine(); engine.playlists.upsert("p", "夜航", listOf("a"), 1.0)
        assertTrue(engine.playlists.remove("p")); assertEquals(3, engine.library().size)
        assertFalse(engine.playlists.remove("p"))
    }
}
