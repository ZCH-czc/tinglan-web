package dev.tinglan.core

import kotlin.io.encoding.Base64
import moe.rukamori.archivetune.musicrecognition.AudioLandmark
import moe.rukamori.archivetune.musicrecognition.FingerprintScore
import moe.rukamori.archivetune.musicrecognition.LocalAudioFingerprint

/** Bounded binary batches cross the worker/Wasm boundary once, never once per PCM sample. */
object LocalFingerprints {
    const val MAX_MARKS=60_000
    private fun int(bytes:ByteArray,offset:Int):Int=(bytes[offset].toInt() and 255) or ((bytes[offset+1].toInt() and 255) shl 8) or ((bytes[offset+2].toInt() and 255) shl 16) or (bytes[offset+3].toInt() shl 24)
    private fun marks(encoded:String):List<AudioLandmark> {
        require(encoded.length<=640_000)
        val bytes=Base64.decode(encoded);require(bytes.size%8==0 && bytes.size<=MAX_MARKS*8)
        return List(bytes.size/8){index->val hash=int(bytes,index*8);val frame=int(bytes,index*8+4);require(hash>=0 && hash<1 shl 25 && frame in 0..10_000_000);AudioLandmark(hash,frame)}
    }
    fun extract(encoded:String,frameOffset:Int):String {
        require(encoded.length<=1_706_668 && frameOffset in 0..10_000_000)
        val bytes=Base64.decode(encoded);require(bytes.size in 4096..1_280_000 && bytes.size%2==0)
        val samples=ShortArray(bytes.size/2){i->((bytes[i*2].toInt() and 255) or (bytes[i*2+1].toInt() shl 8)).toShort()}
        val marks=LocalAudioFingerprint.extract(samples).take(MAX_MARKS)
        val output=ByteArray(marks.size*8)
        fun write(offset:Int,value:Int){repeat(4){output[offset+it]=(value ushr (it*8)).toByte()}}
        marks.forEachIndexed {i,mark->write(i*8,mark.hash);write(i*8+4,mark.frame+frameOffset)}
        return Base64.encode(output)
    }
    fun score(query:String,reference:String):FingerprintScore=LocalAudioFingerprint.score(marks(query),marks(reference).asSequence())
    fun accepts(votes:Int,frames:Int,hashes:Int,runnerVotes:Int,runnerFrames:Int,runnerHashes:Int):Boolean=LocalAudioFingerprint.accepts(FingerprintScore(votes,frames,hashes),if(runnerVotes<0)null else FingerprintScore(runnerVotes,runnerFrames,runnerHashes))
}
