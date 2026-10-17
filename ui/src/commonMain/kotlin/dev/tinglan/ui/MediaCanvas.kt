package dev.tinglan.ui

import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Color

/** Skiko's WebGL renderer clears every frame to opaque white. Clear the actual
 * control surface before drawing so decoded DOM video remains visible beneath it.
 * Do not add an offscreen graphics layer: that would only clear the temporary layer. */
internal fun Modifier.clearMediaCanvasBackground(): Modifier = drawBehind {
    drawRect(Color.Transparent, blendMode = BlendMode.Clear)
}
