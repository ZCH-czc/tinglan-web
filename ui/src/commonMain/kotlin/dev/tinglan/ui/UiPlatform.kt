package dev.tinglan.ui

import androidx.compose.ui.graphics.ImageBitmap

expect fun command(action: String, payload: String = "")
expect fun artworkFor(id: String): ImageBitmap?
