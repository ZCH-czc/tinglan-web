@file:OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
package dev.tinglan.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.*
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

private class GuideAnchor(val requester:BringIntoViewRequester){var bounds by mutableStateOf(Rect.Zero)}
private val anchors=mutableStateMapOf<String,GuideAnchor>()
internal fun Modifier.guideTarget(id:String):Modifier=composed {
    val anchor=remember {GuideAnchor(BringIntoViewRequester())}
    DisposableEffect(id){anchors[id]=anchor;onDispose {if(anchors[id]===anchor)anchors.remove(id)}}
    bringIntoViewRequester(anchor.requester).onGloballyPositioned {anchor.bounds=it.boundsInWindow()}
}
private data class Guide(val id:String,val anchor:String,val title:String,val copy:String)
private fun currentGuide():Guide?=when {
    model.queueOpen->Guide("queue","queue-controls",tr("Manage the queue"),tr("The current track is centered. Hold the handle to reorder, swipe left to remove, and undo mistakes. Lock the queue to prevent changes."))
    model.player->Guide("player","player-seek",tr("Keep the music going"),tr("Drag the seek bar to jump. Tap a lyric to seek, or hold to copy. Choose a lyrics source to switch between platform lyrics and Kugou."))
    model.page=="library"->Guide("library","library-tabs",tr("Organize your library"),tr("Swipe between tabs; the indicator follows your gesture. Reorder tabs from the menu. Playlists support backgrounds, tags, and selection actions."))
    model.page=="settings"->Guide("settings","settings-search",tr("Find settings quickly"),tr("Search settings by name or keyword. Adjust fonts, animation speed, lyrics size, and feature guides here."))
    model.page=="search"->Guide("search","top-actions",tr("Discover more music"),tr("Search tracks or artists. Collapse individual platform results and choose a preferred platform in settings. Save tracks to organize them in your library."))
    model.page=="home"->Guide("home","top-actions",tr("Start here"),tr("Use the shortcut bar for listening history, new releases, and settings. Accounts and recognition are in settings. Imported music, artwork, lyrics, and playlists stay on this device."))
    else->null
}
/** The shared modal portal owns focus, pointer and wheel events throughout the guide. */
@Composable internal fun GuideLayer() {
    val guide=currentGuide()
    val anchor=guide?.let {anchors[it.anchor]}
    val eligible=model.guideEnabled && !model.gallery.open && model.dialog.isEmpty() && !model.busy && !model.video.visible && !model.live.fullscreen && guide!=null && guide.id !in model.guideSeen
    var prepared by remember(guide?.id){mutableStateOf(false)}
    LaunchedEffect(eligible,anchor) {
        prepared=false
        if(eligible && anchor!=null){delay(550);anchor.requester.bringIntoView();withFrameNanos {};prepared=true}
    }
    if(!eligible || !prepared || anchor==null || guide==null || anchor.bounds.width<1f)return
    TinglanModalPanel(identity="guide-${guide.id}",onDismissRequest={command("guide-seen",guide.id)},width=10000.dp,fullHeight=true,color=Color.Transparent,shape=RoundedCornerShape(0.dp),dim=false) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val density=LocalDensity.current
            val rect=anchor.bounds
            val heightPx=with(density){maxHeight.toPx()}
            val highlight=Rect(rect.left.coerceAtLeast(8f),rect.top.coerceAtLeast(8f),rect.right.coerceAtMost(with(density){maxWidth.toPx()}-8f),rect.bottom.coerceAtMost(heightPx-8f))
            Canvas(Modifier.fillMaxSize()) {
                val shade=Path().apply {fillType=PathFillType.EvenOdd;addRect(Rect(0f,0f,size.width,size.height));addRoundRect(androidx.compose.ui.geometry.RoundRect(highlight,androidx.compose.ui.geometry.CornerRadius(16.dp.toPx())))}
                drawPath(shade,Color.Black.copy(alpha=.62f))
            }
            val below=highlight.bottom<heightPx*.52f
            val offset=if(below)with(density){highlight.bottom.toDp()}+18.dp else 24.dp
            Surface(Modifier.align(if(below)Alignment.TopCenter else Alignment.BottomCenter).padding(horizontal=24.dp).padding(top=if(below)offset else 0.dp,bottom=if(below)0.dp else with(density){(heightPx-highlight.top).coerceAtLeast(0f).toDp()}+18.dp).widthIn(max=460.dp).fillMaxWidth(),shape=RoundedCornerShape(24.dp),color=MaterialTheme.colorScheme.surface) {
                Column(Modifier.heightIn(max=(if(below)maxHeight-offset-18.dp else with(density){highlight.top.toDp()}-36.dp).coerceAtLeast(120.dp)).verticalScroll(rememberScrollState()).padding(22.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
                    Text(guide.title,style=MaterialTheme.typography.titleLarge,fontWeight=FontWeight.SemiBold)
                    Text(guide.copy,style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
                    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.End){TextButton(onClick={command("setting",payload("key" to "guideEnabled","value" to "false"))}){Text(tr("Dismiss guide"))};Button(onClick={command("guide-seen",guide.id)}){Text(tr("Got it"))}}
                }
            }
        }
    }
}
