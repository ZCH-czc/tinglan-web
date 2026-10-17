package dev.tinglan.core

import moe.rukamori.archivetune.lyrics.LyricsLineInteraction
import moe.rukamori.archivetune.lyrics.lyricsLineRefreshDelay
import moe.rukamori.archivetune.ui.component.PlayingIndicatorMotion
import kotlin.random.Random

data class Track(val id: String, val title: String, val artist: String, val durationMs: Long, val favorite: Boolean)
enum class RepeatMode { OFF, ALL, ONE }
data class QueuedTrack(val key:String,val index:Int,val track:Track)
private data class QueueSlot(val key:String,val trackId:String)
private data class QueueUndo(val before:List<QueueSlot>,val after:List<String>,val index:Int)

/** Platform-free state: media decoding, storage and UI are injected by the host. */
class MusicEngine {
    private val tracks = linkedMapOf<String, Track>()
    private val queue = mutableListOf<QueueSlot>()
    private val queueEpoch = Random.nextLong().toULong().toString(16)
    private var queueSerial = 0L
    private var cursor = -1
    private var explicitQueue = false
    private var queueUndo:QueueUndo? = null
    private var shuffleKeys = emptyList<String>()
    private var shuffleDirty = true
    var shuffleEnabled = false
        set(value) {if(field!=value){field=value;shuffleKeys=emptyList();shuffleDirty=true}}
    private val lyrics = mutableMapOf<String, LyricsDocument>()
    val playlists = PlaylistCatalog { it in tracks }
    var currentId: String? = null
        private set
    var positionMs: Long = 0
        private set
    var repeatMode: RepeatMode = RepeatMode.OFF

    fun upsert(id: String, title: String, artist: String, duration: Double, favorite: Boolean, enqueue: Boolean = true): Boolean {
        if (id.isBlank() || id.length > 200 || title.length > 2_000 || artist.length > 2_000) return false
        if (id !in tracks && tracks.size >= 10_000) return false
        tracks[id] = Track(id, title.ifBlank { "Untitled track" }, artist.ifBlank { "Local music" }, safeTime(duration), favorite)
        if (enqueue && !explicitQueue && queue.none {it.trackId==id}) {queueUndo=null;shuffleDirty=true;queue.add(slot(id))}
        if (enqueue && currentId == null) activate(0)
        if (currentId == id) setPosition(positionMs.toDouble())
        return true
    }

    /** Release only transient catalog metadata; current playback, queue and saved playlists stay intact. */
    fun releaseUnretained(retained: Set<String>): Int {
        val keep = retained + queue.map {it.trackId} + undoQueueIds() + listOfNotNull(currentId) + playlists.all().flatMap { it.trackIds }
        val removed = tracks.keys.filter { it !in keep }
        removed.forEach { tracks.remove(it); lyrics.remove(it) }
        return removed.size
    }

    fun remove(id: String): Boolean {
        if (tracks.remove(id) == null) return false
        queueUndo=null;shuffleDirty=true
        val activeKey=currentQueueKey();val oldIndex=cursor
        val survivors=queue.withIndex().filter {it.value.trackId!=id}
        queue.clear();queue.addAll(survivors.map {it.value})
        lyrics.remove(id)
        playlists.removeTrack(id)
        if (currentId == id) {
            val adjacent=survivors.firstOrNull {it.index>=oldIndex} ?: survivors.lastOrNull()
            activate(if(adjacent==null)-1 else survivors.indexOf(adjacent),true)
        }else cursor=queue.indexOfFirst {it.key==activeKey}
        return true
    }

    fun select(id: String): Boolean {
        if (id !in tracks) return false
        val index=if(queue.getOrNull(cursor)?.trackId==id)cursor else queue.indexOfFirst {it.trackId==id}
        if(index>=0)activate(index)else {if(currentId!=id)positionMs=0;currentId=id;cursor=-1}
        return true
    }

    private fun slot(id:String)=QueueSlot("q$queueEpoch-${++queueSerial}",id)
    private fun activate(index:Int,reset:Boolean=false) {
        val selected=queue.getOrNull(index);val changed=selected?.key!=currentQueueKey() || selected?.trackId!=currentId
        cursor=if(selected==null)-1 else index;currentId=selected?.trackId
        if(reset || changed)positionMs=0
    }
    fun currentQueueKey():String=queue.getOrNull(cursor)?.takeIf {it.trackId==currentId}?.key.orEmpty()
    fun queueEntryIndex(key:String):Int=queue.indexOfFirst {it.key==key}
    fun queueEntryId(key:String):String?=queue.firstOrNull {it.key==key}?.trackId
    fun selectQueueEntry(key:String):Boolean {val index=queueEntryIndex(key);if(index<0)return false;activate(index);return true}

    fun setPosition(value: Double): Long {
        val duration = tracks[currentId]?.durationMs ?: 0
        positionMs = safeTime(value).coerceAtMost(if (duration > 0) duration else MAX_TIME)
        return positionMs
    }

    /** Manual next skips a repeat-one track; auto-advance obeys repeat mode. */
    fun next(automatic: Boolean): String? {
        if (queue.isEmpty()) return null
        if (automatic && repeatMode == RepeatMode.ONE) { positionMs = 0; return currentId }
        val target=if(!shuffleEnabled) {
            if(cursor+1 in queue.indices)cursor+1 else if(repeatMode==RepeatMode.ALL || !automatic)0 else -1
        }else {
            val order=playbackKeys();val at=order.indexOf(currentQueueKey())
            val next=if(at+1 in order.indices)at+1 else if(repeatMode==RepeatMode.ALL || !automatic)0 else -1
            if(next>=0)queueEntryIndex(order[next])else -1
        }
        if(target<0)return null;activate(target,true);return currentId
    }

    fun previous(): String? {
        if (queue.isEmpty()) return null
        if (positionMs > 3_000) { positionMs = 0; return currentId }
        val target=if(!shuffleEnabled)if(cursor>0)cursor-1 else queue.lastIndex else {
            val order=playbackKeys();val at=order.indexOf(currentQueueKey());queueEntryIndex(order[if(at>0)at-1 else order.lastIndex])
        }
        activate(target,true)
        return currentId
    }

    private fun playbackKeys():List<String> {
        if(!shuffleDirty)return shuffleKeys
        val keys=queue.map {it.key}
        if(!shuffleEnabled)return keys
        val valid=keys.toSet();val retained=shuffleKeys.filter {it in valid}
        val known=retained.toSet();val added=keys.filter {it !in known}.shuffled()
        shuffleKeys=if(retained.isEmpty())listOfNotNull(currentQueueKey().takeIf {it.isNotEmpty()})+added.filter {it!=currentQueueKey()} else retained+added
        shuffleDirty=false
        return shuffleKeys
    }

    fun move(id: String, destination: Int): Boolean {
        val key=if(currentId==id)currentQueueKey() else queue.firstOrNull {it.trackId==id}?.key.orEmpty()
        return moveEntry(key,destination)
    }
    fun moveEntry(key:String,destination:Int):Boolean {
        val index = queueEntryIndex(key)
        if (index < 0 || destination !in queue.indices) return false
        if(index==destination)return false
        queueUndo=null;shuffleDirty=true
        val activeKey=currentQueueKey();val entry=queue.removeAt(index)
        queue.add(destination,entry);cursor=queue.indexOfFirst {it.key==activeKey}
        return true
    }

    /** Queue edits do not delete the library entry or its lyrics. */
    fun dequeue(id: String): Boolean {
        val key=if(currentId==id)currentQueueKey() else queue.firstOrNull {it.trackId==id}?.key.orEmpty()
        return dequeueEntry(key)
    }
    fun dequeueEntry(key:String):Boolean {
        val index=queueEntryIndex(key)
        if (index < 0) return false
        val before=queue.toList();val oldIndex=cursor
        shuffleDirty=true
        val activeKey=currentQueueKey();queue.removeAt(index)
        explicitQueue = true
        if(activeKey==key)activate(index.coerceAtMost(queue.lastIndex),true)
        else cursor=queue.indexOfFirst {it.key==activeKey}
        queueUndo=QueueUndo(before,queue.map {it.key},oldIndex)
        return true
    }

    fun insertQueued(id:String,next:Boolean=false):String? {
        if(id !in tracks || queue.size>=10000)return null
        queueUndo=null;shuffleDirty=true
        val active=currentQueueKey();val entry=slot(id)
        queue.add(if(next)(cursor+1).coerceIn(0,queue.size)else queue.size,entry);explicitQueue=true
        if(currentId==null)activate(0)else cursor=queue.indexOfFirst {it.key==active}
        return entry.key
    }

    fun clearQueue() {queueUndo=null;shuffleKeys=emptyList();shuffleDirty=true;queue.clear();cursor=-1;explicitQueue = true; currentId = null; positionMs = 0 }

    /** Keep the exact playing occurrence and its clock; clearing must not restart audio. */
    fun clearOtherQueueEntries():Int {
        val active=queue.getOrNull(cursor)?.takeIf {it.key==currentQueueKey()} ?: return 0
        val removed=queue.size-1;if(removed<=0)return 0
        val before=queue.toList();val oldIndex=cursor
        shuffleDirty=true
        queue.clear();queue.add(active);cursor=0;explicitQueue=true
        queueUndo=QueueUndo(before,listOf(active.key),oldIndex)
        return removed
    }
    fun canUndoQueueEdit():Boolean=queueUndo?.let {undo->
        undo.after==queue.map {it.key} && undo.before.all {it.trackId in tracks}
    } ?: false
    fun undoQueueIds():List<String> = queueUndo?.before?.map {it.trackId} ?: emptyList()
    fun discardQueueUndo(){queueUndo=null}
    fun undoQueueEdit():Boolean {
        if(!canUndoQueueEdit())return false
        val undo=queueUndo ?: return false;val active=currentQueueKey()
        queueUndo=null;shuffleDirty=true;queue.clear();queue.addAll(undo.before)
        val restored=queue.indexOfFirst {it.key==active}
        if(restored>=0)cursor=restored else activate(undo.index.coerceIn(0,queue.lastIndex),true)
        return true
    }
    fun queueDurationMs():Long=queue.sumOf {tracks[it.trackId]?.durationMs ?: 0}

    fun setQueue(ids: List<String>,selectedIndex:Int?=null): Boolean {
        if (ids.isEmpty() || ids.size > 10_000 || ids.any { it !in tracks } || selectedIndex!=null && selectedIndex !in ids.indices) return false
        if(queue.map {it.trackId}==ids){explicitQueue=true;if(selectedIndex!=null)activate(selectedIndex);return true}
        queueUndo=null;shuffleKeys=emptyList();shuffleDirty=true
        val active=queue.getOrNull(cursor)?.takeIf {it.trackId==currentId};val oldId=currentId
        val available=mutableMapOf<String,ArrayDeque<QueueSlot>>()
        for(entry in queue)available.getOrPut(entry.trackId){ArrayDeque()}.addLast(entry)
        val accepted=ids.map {available[it]?.removeFirstOrNull() ?: slot(it)}.toMutableList()
        if(selectedIndex==null && active!=null && accepted.none {it.key==active.key}) {
            val at=accepted.indexOfFirst {it.trackId==active.trackId};if(at>=0)accepted[at]=active
        }
        queue.clear();queue.addAll(accepted)
        explicitQueue = true
        val at=selectedIndex ?: accepted.indexOfFirst {it.key==active?.key}.takeIf {it>=0} ?: accepted.indexOfFirst {it.trackId==oldId}.takeIf {it>=0} ?: 0
        val selected=accepted[at];cursor=at;currentId=selected.trackId
        if(oldId!=currentId || selectedIndex!=null && active?.key!=selected.key)positionMs=0
        return true
    }

    fun toggleFavorite(id: String): Boolean {
        val track = tracks[id] ?: return false
        tracks[id] = track.copy(favorite = !track.favorite)
        return !track.favorite
    }

    fun library(query: String = "", favoritesOnly: Boolean = false): List<Track> {
        val needle = query.trim().lowercase()
        return tracks.values.filter { (!favoritesOnly || it.favorite) && (needle.isEmpty() || it.title.lowercase().contains(needle) || it.artist.lowercase().contains(needle)) }
    }
    fun queuedTracks(): List<Track> = queue.mapNotNull {tracks[it.trackId]}
    fun queuedIds(): List<String> = queue.map {it.trackId}
    fun queueSize(): Int = queue.size
    fun currentQueueIndex(): Int = cursor
    fun queueWindow(start: Int, limit: Int): List<Track> {
        val from = start.coerceIn(0, queue.size)
        return queue.subList(from, (from + limit.coerceIn(0, 500)).coerceAtMost(queue.size)).mapNotNull {tracks[it.trackId]}
    }
    fun queueEntries(start:Int,limit:Int):List<QueuedTrack> {
        val from=start.coerceIn(0,queue.size);val end=(from+limit.coerceIn(0,500)).coerceAtMost(queue.size)
        return (from until end).mapNotNull {i->tracks[queue[i].trackId]?.let {QueuedTrack(queue[i].key,i,it)}}
    }
    fun currentTrack(): Track? = tracks[currentId]

    fun setLyrics(id: String, text: String): LyricsDocument? {
        if (id !in tracks || text.length > LyricsParser.MAX_TEXT) return null
        return LyricsParser.parse(text).also { lyrics[id] = it }
    }
    fun lyrics(id: String): LyricsDocument = lyrics[id] ?: LyricsDocument(emptyList(), false, 0)
    fun activeLyric(id: String, position: Double): Int = lyrics(id).activeIndex(safeTime(position))
    fun lyricSeek(id: String, index: Int): Long? {
        val doc = lyrics(id)
        val line = doc.lines.getOrNull(index) ?: return null
        return LyricsLineInteraction.seekPosition(line.timeMs, doc.synced, 0, tracks[id]?.durationMs ?: 0)
    }
    fun lyricRefreshDelay(id: String, position: Double, speed: Float): Long {
        val doc = lyrics(id)
        val time = safeTime(position)
        val index = doc.activeIndex(time)
        return lyricsLineRefreshDelay(time, doc.lines.getOrNull(index + 1)?.timeMs, speed)
    }
    fun waveform(phase: Float, bar: Int): Float = PlayingIndicatorMotion.height(phase, bar)

    companion object {
        const val MAX_TIME: Long = 30L * 24 * 60 * 60 * 1_000
        fun safeTime(value: Double): Long = if (value.isFinite()) value.coerceIn(0.0, MAX_TIME.toDouble()).toLong() else 0
    }
}
