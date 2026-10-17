package moe.rukamori.archivetune.musicrecognition

import kotlin.math.*

data class AudioLandmark(val hash: Int, val frame: Int)
data class FingerprintScore(val votes: Int, val matchedFrames: Int, val distinctHashes: Int)

/** A self-contained spectral landmark index. No audio leaves the device. PCM is 16 kHz mono. */
object LocalAudioFingerprint {
    const val SAMPLE_RATE = 16_000
    const val HOP = 512
    private const val SIZE = 1024
    private val window = DoubleArray(SIZE) { .5 - .5 * cos(2 * PI * it / (SIZE - 1)) }
    private val bands = intArrayOf(6, 18, 42, 86, 170, 320)

    fun extract(samples: ShortArray): List<AudioLandmark> {
        if (samples.size < SIZE * 2) return emptyList()
        val count = (samples.size - SIZE) / HOP + 1
        val peaks = Array(count) { IntArray(5) { -1 } }
        val real = DoubleArray(SIZE); val imaginary = DoubleArray(SIZE)
        for (frame in 0 until count) {
            var energy = 0.0
            for (i in 0 until SIZE) { val value = samples[frame * HOP + i].toDouble() / 32768; real[i] = value * window[i]; imaginary[i] = 0.0; energy += value * value }
            if (energy / SIZE < .00001) continue
            fft(real, imaginary)
            for (band in 0..4) {
                var best = bands[band]; var power = 0.0
                for (bin in bands[band] until bands[band + 1]) {
                    val candidate = real[bin] * real[bin] + imaginary[bin] * imaginary[bin]
                    if (candidate > power) { power = candidate; best = bin }
                }
                if (power > .005) peaks[frame][band] = best / 2
            }
        }
        return buildList {
            for (frame in 0 until count step 2) for (delta in intArrayOf(2, 4, 7)) {
                if (frame + delta >= count) continue
                for (band in 0..4) {
                    val first = peaks[frame][band]; val next = peaks[frame + delta][band]
                    if (first >= 0 && next >= 0) add(AudioLandmark((band shl 22) or (delta shl 16) or (first shl 8) or next, frame))
                }
            }
        }
    }

    fun score(query: List<AudioLandmark>, reference: Sequence<AudioLandmark>): FingerprintScore {
        val queryTimes = query.groupBy { it.hash }.mapValues { (_, marks) -> marks.map { it.frame }.distinct().take(40) }
        val marks = reference.take(60_000).toList()
        // Count candidate offsets first; retain sets for only eight finalists. Repeated
        // musical phrases must not allocate millions of boxed vote objects per track.
        val offsets = HashMap<Int, Int>()
        marks.forEach { mark -> queryTimes[mark.hash]?.forEach { time ->
            val offset = mark.frame - time
            // One frame tolerance accounts for capture phase and decoder seek boundaries.
            for (bucket in (offset - 1)..(offset + 1)) {
                offsets[bucket] = (offsets[bucket] ?: 0) + 1
            }
        } }
        val finalists = offsets.entries.sortedByDescending { it.value }.take(8).map { it.key }
        return finalists.map { bucket ->
            val votes = HashSet<Long>(); val hashes = HashSet<Int>(); val frames = HashSet<Int>()
            marks.forEach { mark -> queryTimes[mark.hash]?.forEach { time ->
                if (abs(mark.frame - time - bucket) <= 1) {
                    votes.add((mark.hash.toLong() shl 32) or time.toLong()); hashes.add(mark.hash); frames.add(time)
                }
            } }
            FingerprintScore(votes.size, frames.size, hashes.size)
        }.maxByOrNull { it.votes } ?: FingerprintScore(0, 0, 0)
    }
    fun accepts(best: FingerprintScore, runnerUp: FingerprintScore?): Boolean = best.votes >= 60 && best.matchedFrames >= 24 &&
        best.distinctHashes >= 12 && (runnerUp == null || best.votes >= runnerUp.votes * 1.5 + 6)

    private fun fft(real: DoubleArray, imaginary: DoubleArray) {
        var j = 0
        for (i in 1 until SIZE) {
            var bit = SIZE shr 1
            while ((j and bit) != 0) { j = j xor bit; bit = bit shr 1 }
            j = j xor bit
            if (i < j) { val r = real[i]; real[i] = real[j]; real[j] = r; val im = imaginary[i]; imaginary[i] = imaginary[j]; imaginary[j] = im }
        }
        var length = 2
        while (length <= SIZE) {
            val stepR = cos(-2 * PI / length); val stepI = sin(-2 * PI / length)
            for (start in 0 until SIZE step length) {
                var wr = 1.0; var wi = 0.0
                for (k in 0 until length / 2) {
                    val even = start + k; val odd = even + length / 2
                    val r = real[odd] * wr - imaginary[odd] * wi; val im = real[odd] * wi + imaginary[odd] * wr
                    real[odd] = real[even] - r; imaginary[odd] = imaginary[even] - im; real[even] += r; imaginary[even] += im
                    val next = wr * stepR - wi * stepI; wi = wr * stepI + wi * stepR; wr = next
                }
            }
            length *= 2
        }
    }
}
