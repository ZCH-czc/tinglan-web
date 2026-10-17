package dev.tinglan.core

import kotlin.test.*

class QueueParityTest {
    private fun engine(ids:List<String> = listOf("a","b","a","c"),index:Int=2)=MusicEngine().apply {
        ids.distinct().forEach {upsert(it,it,"听岚",60000.0,false,enqueue=false)}
        setQueue(ids,index);setPosition(17000.0)
    }
    @Test fun clearOthersAndUndoKeepExactOccurrenceAndClock() {
        val e=engine();val rows=e.queueEntries(0,4);val key=e.currentQueueKey()
        assertEquals(240000,e.queueDurationMs());assertEquals(3,e.clearOtherQueueEntries())
        assertEquals(key,e.currentQueueKey());assertEquals(17000,e.positionMs);assertEquals(listOf("a"),e.queuedIds());assertTrue(e.canUndoQueueEdit())
        assertEquals(0,e.clearOtherQueueEntries());assertTrue(e.undoQueueEdit())
        assertEquals(rows,e.queueEntries(0,4));assertEquals(2,e.currentQueueIndex());assertEquals(17000,e.positionMs);assertFalse(e.undoQueueEdit())
    }
    @Test fun removeUndoDoesNotInterruptTheNewCurrentSong() {
        val e=engine();val removed=e.currentQueueKey();assertTrue(e.dequeueEntry(removed));assertEquals("c",e.currentId)
        e.setPosition(9000.0);val current=e.currentQueueKey();assertTrue(e.undoQueueEdit())
        assertEquals(current,e.currentQueueKey());assertEquals(9000,e.positionMs);assertEquals(4,e.queueSize())
    }
    @Test fun undoLastRemovalRestoresTheItemWithoutRestoringAnOldClock() {
        val e=engine(listOf("a"),0);val key=e.currentQueueKey();assertTrue(e.dequeueEntry(key));assertNull(e.currentId)
        assertTrue(e.undoQueueEdit());assertEquals(key,e.currentQueueKey());assertEquals(0,e.positionMs)
    }
    @Test fun aNewQueueEditInvalidatesOldUndoAndExpiredUndoReleasesCatalog() {
        val e=engine();e.clearOtherQueueEntries();assertEquals(0,e.releaseUnretained(emptySet()))
        e.discardQueueUndo();assertFalse(e.canUndoQueueEdit());assertEquals(2,e.releaseUnretained(emptySet()))
        e.upsert("b","b","听岚",60000.0,false,enqueue=false);e.insertQueued("b");e.dequeueEntry(e.queueEntries(0,2)[1].key)
        assertTrue(e.canUndoQueueEdit());e.insertQueued("b");assertFalse(e.undoQueueEdit());assertEquals(listOf("a","b"),e.queuedIds())
    }
    @Test fun shuffleVisitsEveryOccurrenceAndPreviousReturnsThroughTheSameOrder() {
        val e=engine(List(80){if(it%2==0)"a"else "b"},31);val original=e.queuedIds();e.shuffleEnabled=true
        val keys=mutableListOf(e.currentQueueKey())
        repeat(79){assertNotNull(e.next(true));keys.add(e.currentQueueKey())}
        assertEquals(80,keys.toSet().size);assertNull(e.next(true));assertEquals(original,e.queuedIds())
        keys.dropLast(1).asReversed().forEach {expected->assertNotNull(e.previous());assertEquals(expected,e.currentQueueKey())}
        e.repeatMode=RepeatMode.ONE;val current=e.currentQueueKey();assertNotNull(e.next(true));assertEquals(current,e.currentQueueKey())
        assertNotNull(e.next(false));assertNotEquals(current,e.currentQueueKey())
    }
    @Test fun shuffleRemainsValidAfterReorderRemovalAndInsertion() {
        val e=engine();e.shuffleEnabled=true;e.next(false);val current=e.currentQueueKey()
        e.moveEntry(current,0);e.insertQueued("b");e.dequeueEntry(e.queueEntries(0,5).last().key)
        val expected=e.queueEntries(0,4).map {it.key}.toSet();val seen=mutableSetOf<String>()
        repeat(4){seen.add(e.currentQueueKey());e.next(false)}
        assertEquals(expected,seen)
    }
    @Test fun nativeViewportGeometryIncludesRealPaddingAndRejectsUnmeasuredItems() {
        assertEquals(0f,queueCenterDelta(0,0,0,500,0,0));assertEquals(0f,queueCenterDelta(0,50,0,0,0,0))
        assertEquals(0f,queueCenterDelta(220,60,0,500,0,0));assertEquals(20f,queueCenterDelta(240,60,0,500,0,0))
        assertEquals(10f,queueCenterDelta(220,60,0,500,0,20));assertEquals(-240f,queueCenterDelta(-20,60,0,500,0,0))
    }
}
