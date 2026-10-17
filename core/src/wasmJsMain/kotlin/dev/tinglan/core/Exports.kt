@file:OptIn(kotlin.js.ExperimentalJsExport::class)
package dev.tinglan.core

import kotlin.js.JsExport

private var engine = MusicEngine()

@JsExport fun engineVersion(): String = "0.31.1"
@JsExport fun localFingerprintExtract(pcm:String,offset:Int):String=LocalFingerprints.extract(pcm,offset)
@JsExport fun localFingerprintScore(query:String,reference:String):String=LocalFingerprints.score(query,reference).let {"${it.votes},${it.matchedFrames},${it.distinctHashes}"}
@JsExport fun localFingerprintAccepts(votes:Int,frames:Int,hashes:Int,runnerVotes:Int,runnerFrames:Int,runnerHashes:Int):Boolean=LocalFingerprints.accepts(votes,frames,hashes,runnerVotes,runnerFrames,runnerHashes)
@JsExport fun resetEngine() { engine = MusicEngine() }
@JsExport fun upsertTrack(id: String, title: String, artist: String, durationMs: Double, favorite: Boolean): Boolean = engine.upsert(id, title, artist, durationMs, favorite)
@JsExport fun upsertMetadata(id: String, title: String, artist: String, durationMs: Double, favorite: Boolean): Boolean = engine.upsert(id, title, artist, durationMs, favorite, enqueue = false)
@JsExport fun releaseUnretained(ids: String): Int = engine.releaseUnretained(ids.split('\n').filter(String::isNotEmpty).toSet())
@JsExport fun removeTrack(id: String): Boolean = engine.remove(id)
@JsExport fun selectTrack(id: String): Boolean = engine.select(id)
@JsExport fun setPosition(positionMs: Double): Double = engine.setPosition(positionMs).toDouble()
@JsExport fun currentId(): String = engine.currentId ?: ""
@JsExport fun positionMs(): Double = engine.positionMs.toDouble()
@JsExport fun nextTrack(automatic: Boolean): String = engine.next(automatic) ?: ""
@JsExport fun previousTrack(): String = engine.previous() ?: ""
@JsExport fun moveTrack(id: String, index: Int): Boolean = engine.move(id, index)
@JsExport fun removeQueuedTrack(id: String): Boolean = engine.dequeue(id)
@JsExport fun clearQueue() { engine.clearQueue() }
@JsExport fun clearOtherQueueEntries():Int=engine.clearOtherQueueEntries()
@JsExport fun canUndoQueueEdit():Boolean=engine.canUndoQueueEdit()
@JsExport fun undoQueueEdit():Boolean=engine.undoQueueEdit()
@JsExport fun discardQueueUndo(){engine.discardQueueUndo()}
@JsExport fun undoQueueIdsJson():String=engine.undoQueueIds().joinToString(prefix="[",postfix="]"){it.jsonString()}
@JsExport fun queueDurationMs():Double=engine.queueDurationMs().toDouble()
@JsExport fun setShuffleEnabled(value:Boolean){engine.shuffleEnabled=value}
@JsExport fun shuffleEnabled():Boolean=engine.shuffleEnabled
@JsExport fun setQueueIds(ids: String): Boolean = engine.setQueue(ids.split('\n'))
@JsExport fun setQueueIdsAt(ids:String,index:Int):Boolean=engine.setQueue(ids.split('\n'),index)
@JsExport fun currentQueueKey():String=engine.currentQueueKey()
@JsExport fun selectQueueEntry(key:String):Boolean=engine.selectQueueEntry(key)
@JsExport fun queueEntryIndex(key:String):Int=engine.queueEntryIndex(key)
@JsExport fun queueEntryId(key:String):String=engine.queueEntryId(key).orEmpty()
@JsExport fun moveQueueEntry(key:String,index:Int):Boolean=engine.moveEntry(key,index)
@JsExport fun removeQueueEntry(key:String):Boolean=engine.dequeueEntry(key)
@JsExport fun insertQueueTrack(id:String,next:Boolean):String=engine.insertQueued(id,next).orEmpty()
@JsExport fun upsertPlaylist(id: String, name: String, ids: String, createdAt: Double): Boolean =
    engine.playlists.upsert(id, name, if (ids.isEmpty()) emptyList() else ids.split('\n'), createdAt)
@JsExport fun addPlaylistSong(id: String, trackId: String): Boolean = engine.playlists.add(id, trackId)
@JsExport fun removePlaylistSong(id: String, trackId: String): Boolean = engine.playlists.removeSong(id, trackId)
@JsExport fun removePlaylist(id: String): Boolean = engine.playlists.remove(id)
@JsExport fun playlistJson(id: String): String = engine.playlists.get(id)?.json() ?: "null"
@JsExport fun playlistsJson(): String = engine.playlists.all().joinToString(prefix = "[", postfix = "]") { it.json() }
@JsExport fun toggleFavorite(id: String): Boolean = engine.toggleFavorite(id)
@JsExport fun setRepeatMode(mode: String) { engine.repeatMode = RepeatMode.entries.firstOrNull { it.name == mode } ?: RepeatMode.OFF }
@JsExport fun repeatMode(): String = engine.repeatMode.name
@JsExport fun libraryJson(query: String, favoritesOnly: Boolean): String = engine.library(query, favoritesOnly).json()
@JsExport fun queueJson(): String = engine.queuedTracks().json()
@JsExport fun queueSize(): Int = engine.queueSize()
@JsExport fun currentQueueIndex(): Int = engine.currentQueueIndex()
@JsExport fun queueWindowJson(start: Int, limit: Int): String = engine.queueWindow(start, limit).json()
@JsExport fun queueItemsJson(start:Int,limit:Int):String=engine.queueEntries(start,limit).joinToString(prefix="[",postfix="]"){it.json()}
@JsExport fun queueIdsJson(): String = engine.queuedIds().joinToString(prefix="[", postfix="]") { it.jsonString() }
@JsExport fun currentTrackJson(): String = engine.currentTrack()?.json() ?: "null"
@JsExport fun setLyrics(id: String, text: String): Boolean = engine.setLyrics(id, text) != null
@JsExport fun lyricsJson(id: String): String = engine.lyrics(id).json()
@JsExport fun activeLyric(id: String, positionMs: Double): Int = engine.activeLyric(id, positionMs)
@JsExport fun lyricSeekMs(id: String, index: Int): Double = engine.lyricSeek(id, index)?.toDouble() ?: -1.0
@JsExport fun lyricRefreshDelay(id: String, positionMs: Double, speed: Float): Double = engine.lyricRefreshDelay(id, positionMs, speed).toDouble()
@JsExport fun waveform(phase: Float, bar: Int): Float = engine.waveform(phase, bar)
