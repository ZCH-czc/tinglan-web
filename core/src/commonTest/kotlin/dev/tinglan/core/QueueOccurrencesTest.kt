package dev.tinglan.core

import kotlin.test.*

class QueueOccurrencesTest {
    private fun populated()=MusicEngine().apply {listOf("a","b","c").forEach {upsert(it,it,"听岚",60000.0,false,enqueue=false)}}
    @Test fun duplicateEntriesAdvanceAndSelectByOccurrence() {
        val e=populated();assertTrue(e.setQueue(listOf("a","b","a","c"),2))
        val key=e.currentQueueKey();assertEquals("a",e.currentId);assertEquals(2,e.currentQueueIndex())
        e.setPosition(9000.0);assertTrue(e.select("a"));assertEquals(key,e.currentQueueKey());assertEquals(9000,e.positionMs)
        assertEquals("c",e.next(false));assertEquals(3,e.currentQueueIndex());assertEquals("a",e.previous());assertEquals(key,e.currentQueueKey())
        assertTrue(e.selectQueueEntry(e.queueEntries(0,4)[0].key));assertEquals(0,e.currentQueueIndex());assertNotEquals(key,e.currentQueueKey())
    }
    @Test fun movingOneOccurrencePreservesItsPlaybackAndAllKeys() {
        val e=populated();e.setQueue(listOf("a","b","a","c"),2);e.setPosition(12345.0)
        val entries=e.queueEntries(0,4);val key=e.currentQueueKey()
        assertTrue(e.moveEntry(entries[0].key,3));assertEquals(1,e.currentQueueIndex());assertEquals(key,e.currentQueueKey());assertEquals(12345,e.positionMs)
        assertEquals(entries.map {it.key}.toSet(),e.queueEntries(0,4).map {it.key}.toSet())
        assertTrue(e.moveEntry(key,3));assertEquals(3,e.currentQueueIndex());assertEquals(12345,e.positionMs)
    }
    @Test fun deletingAnotherDuplicateDoesNotRestartThePlayingOccurrence() {
        val e=populated();e.setQueue(listOf("a","b","a"),2);e.setPosition(9000.0)
        val key=e.currentQueueKey();assertTrue(e.dequeueEntry(e.queueEntries(0,3)[0].key))
        assertEquals(key,e.currentQueueKey());assertEquals(1,e.currentQueueIndex());assertEquals(9000,e.positionMs);assertEquals(listOf("b","a"),e.queuedIds())
    }
    @Test fun deletingCurrentSelectsNextOccurrenceEvenWhenItsAssetIsTheSame() {
        val e=populated();e.setQueue(listOf("a","a","b"),0);e.setPosition(9000.0)
        val second=e.queueEntries(0,3)[1].key;assertTrue(e.dequeueEntry(e.currentQueueKey()));assertEquals("a",e.currentId);assertEquals(second,e.currentQueueKey());assertEquals(0,e.positionMs)
        assertEquals(3,e.library().size)
    }
    @Test fun removingAnAssetCleansEveryOccurrenceAndSelectsNearestSurvivor() {
        val e=populated();e.setQueue(listOf("a","b","a","a","c","b"),3)
        assertTrue(e.remove("a"));assertEquals(listOf("b","c","b"),e.queuedIds());assertEquals("c",e.currentId);assertEquals(1,e.currentQueueIndex())
        val key=e.currentQueueKey();e.setPosition(9000.0);assertTrue(e.remove("b"));assertEquals(listOf("c"),e.queuedIds());assertEquals(key,e.currentQueueKey());assertEquals(9000,e.positionMs)
    }
    @Test fun replacingAnUnchangedQueueKeepsOccurrenceAndSubsetReplacementKeepsTheCurrentKey() {
        val e=populated();val ids=listOf("a","b","a","c");e.setQueue(ids,2);e.setPosition(9000.0);val key=e.currentQueueKey()
        assertTrue(e.setQueue(ids));assertEquals(2,e.currentQueueIndex());assertEquals(key,e.currentQueueKey());assertEquals(9000,e.positionMs)
        assertTrue(e.setQueue(listOf("a","c")));assertEquals(key,e.currentQueueKey());assertEquals(0,e.currentQueueIndex());assertEquals(9000,e.positionMs)
    }
    @Test fun invalidAndStaleKeysNeverEditAnotherOccurrence() {
        val e=populated();e.setQueue(listOf("a","a"),1);val before=e.queueEntries(0,2);val key=e.currentQueueKey();e.setPosition(5000.0)
        assertFalse(e.selectQueueEntry("missing"));assertFalse(e.moveEntry("missing",0));assertFalse(e.dequeueEntry("missing"));assertFalse(e.setQueue(listOf("a","missing"),1));assertFalse(e.setQueue(listOf("a","a"),2))
        assertEquals(before,e.queueEntries(0,2));assertEquals(key,e.currentQueueKey());assertEquals(5000,e.positionMs)
        e.clearQueue();e.setQueue(listOf("a","a"));assertFalse(e.selectQueueEntry(key));assertNotEquals(key,e.currentQueueKey())
    }
    @Test fun nextAndAppendAllocateSeparateEntriesWithoutInterruptingCurrentPlayback() {
        val e=populated();e.setQueue(listOf("a","b"));e.setPosition(5000.0);val active=e.currentQueueKey()
        val next=e.insertQueued("a",true);val last=e.insertQueued("a");assertNotNull(next);assertNotNull(last);assertNotEquals(next,last)
        assertEquals(listOf("a","a","b","a"),e.queuedIds());assertEquals(active,e.currentQueueKey());assertEquals(5000,e.positionMs)
        e.next(false);assertEquals(next,e.currentQueueKey());assertEquals(0,e.positionMs)
    }
    @Test fun largeDuplicateQueueUsesBoundedWindowsAndSurvivesRapidSkipping() {
        val e=populated();assertTrue(e.setQueue(List(10000){"a"},9500));assertEquals(3,e.library().size)
        val window=e.queueEntries(9380,240);assertEquals(240,window.size);assertEquals(e.currentQueueKey(),window[120].key);assertEquals(9500,window[120].index)
        assertEquals(500,e.queueEntries(0,10000).size);assertEquals(500,e.queueEntries(0,500).map {it.key}.toSet().size)
        repeat(10000){e.next(false);e.previous()};assertEquals(9500,e.currentQueueIndex());assertNull(e.insertQueued("a"));assertFalse(e.setQueue(List(10001){"a"}))
    }
}
