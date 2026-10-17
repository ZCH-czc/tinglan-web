package moe.rukamori.archivetune.ui.component

import kotlin.math.PI
import kotlin.math.sin

/** Deterministic, seamless 1.2 second waveform; phase changes only invalidate drawing. */
internal object PlayingIndicatorMotion {
    fun height(phase: Float, bar: Int): Float {
        val safe = if (phase.isFinite()) phase else 0f
        return (.55 + .35 * sin(safe * 2 * PI + bar * 2.1)).toFloat()
    }
}
