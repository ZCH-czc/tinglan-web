package dev.tinglan.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.*

@Composable internal fun ContentPicture(id:String,size:Dp) {
    val pixels=with(LocalDensity.current){size.toPx()}
    val bucket=when {pixels<=384->384;pixels<=768->768;else->1280}
    val key="$id:picture-$bucket"
    val revision=artRevision
    // A visible image keeps its decoded reference if the shared LRU evicts it.
    // Otherwise a large nine-picture card can continuously reload its own images.
    val visibleImage=remember(key){arrayOfNulls<ImageBitmap>(1)}
    val bitmap=artworkFor(key)?.also {visibleImage[0]=it}?:visibleImage[0]
    LaunchedEffect(key,bitmap){if(bitmap==null)command("cover",key)}
    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surfaceContainerHigh),contentAlignment=Alignment.Center) {
        if(bitmap!=null)Image(bitmap,null,Modifier.fillMaxSize(),contentScale=ContentScale.Crop,filterQuality=FilterQuality.Medium)
        else Glyph("artwork",Modifier.size(28.dp),MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
