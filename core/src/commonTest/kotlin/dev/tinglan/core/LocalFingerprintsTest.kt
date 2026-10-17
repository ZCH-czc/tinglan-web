package dev.tinglan.core

import kotlin.io.encoding.Base64
import kotlin.math.*
import kotlin.random.Random
import kotlin.test.*
import moe.rukamori.archivetune.musicrecognition.LocalAudioFingerprint

class LocalFingerprintsTest {
    private fun music(seconds:Int,seed:Int):ShortArray {
        val random=Random(seed);val melody=Array(seconds*4+1){IntArray(5){b->100+b*b*200+random.nextInt(80,180)}};val phase=DoubleArray(5)
        return ShortArray(seconds*16000){i->var value=0.0;for(b in 0..4){phase[b]+=2*PI*melody[i/4000][b]/16000;value+=sin(phase[b])*2400*(.8+.2*sin(i/800.0))};value.toInt().coerceIn(-32768,32767).toShort()}
    }
    private fun pcm(samples:ShortArray):String {val bytes=ByteArray(samples.size*2);samples.forEachIndexed {i,n->bytes[i*2]=n.toByte();bytes[i*2+1]=(n.toInt() shr 8).toByte()};return Base64.encode(bytes)}
    @Test fun binaryBridgePreservesNativeLandmarksAndWindowOffset(){
        val samples=music(4,7);val expected=LocalAudioFingerprint.extract(samples);val bytes=Base64.decode(LocalFingerprints.extract(pcm(samples),123));assertEquals(expected.size*8,bytes.size)
        fun int(i:Int)=(bytes[i].toInt() and 255) or ((bytes[i+1].toInt() and 255) shl 8) or ((bytes[i+2].toInt() and 255) shl 16) or (bytes[i+3].toInt() shl 24)
        expected.forEachIndexed {i,mark->assertEquals(mark.hash,int(i*8));assertEquals(mark.frame+123,int(i*8+4))}
    }
    @Test fun offsetQuietRecordingMatchesWithNoiseAndAnUnrelatedRunner(){
        val source=music(18,7);val random=Random(25);val query=source.copyOfRange(6*16000+213,12*16000+213).map{(it*.6+random.nextInt(-180,181)).toInt().toShort()}.toShortArray()
        val q=LocalFingerprints.extract(pcm(query),0);val best=LocalFingerprints.score(q,LocalFingerprints.extract(pcm(source),0));val runner=LocalFingerprints.score(q,LocalFingerprints.extract(pcm(music(18,42)),0))
        assertTrue(LocalFingerprints.accepts(best.votes,best.matchedFrames,best.distinctHashes,runner.votes,runner.matchedFrames,runner.distinctHashes),"best=$best runner=$runner")
    }
    @Test fun noiseAndSilenceCannotProduceAnAcceptedMatch(){
        assertEquals("",LocalFingerprints.extract(pcm(ShortArray(96000)),0));val random=Random(39);val q=LocalFingerprints.extract(pcm(ShortArray(96000){random.nextInt(-5000,5001).toShort()}),0);val score=LocalFingerprints.score(q,LocalFingerprints.extract(pcm(music(12,7)),0))
        assertFalse(LocalFingerprints.accepts(score.votes,score.matchedFrames,score.distinctHashes,-1,0,0))
    }
    @Test fun lowDiversityRunnerStillInvalidatesAnAmbiguousMatch(){assertFalse(LocalFingerprints.accepts(60,40,12,40,40,1));assertTrue(LocalFingerprints.accepts(60,40,12,-1,0,0));assertFalse(LocalFingerprints.accepts(100,40,12,95,30,12))}
    @Test fun malformedAndOversizedBinaryInputFailsBeforeAnalysis(){
        assertFails{LocalFingerprints.extract("A".repeat(1_706_669),0)};assertFails{LocalFingerprints.extract(Base64.encode(ByteArray(4095)),0)};assertFails{LocalFingerprints.extract(pcm(ShortArray(96000)),-1)};assertFails{LocalFingerprints.score("AA==","")}
        assertFails{LocalFingerprints.score(Base64.encode(byteArrayOf(-1,-1,-1,-1,0,0,0,0)),"")}
    }
}
