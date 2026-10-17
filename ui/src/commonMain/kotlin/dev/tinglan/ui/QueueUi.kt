@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
package dev.tinglan.ui

import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.*
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.tinglan.core.playingBarHeight
import dev.tinglan.core.queueCenterDelta
import kotlinx.coroutines.flow.first

internal fun playbackOrderLabel()=if(model.shuffle)tr("Shuffle")else when(model.repeat){"ALL"->tr("Repeat all");"ONE"->tr("Repeat one");else->tr("Play in order")}
internal fun playbackOrderIcon()=if(model.shuffle)"shuffle"else when(model.repeat){"ALL"->"repeat";"ONE"->"repeat-one";else->"sequence"}
private fun queueDurationLabel(ms:Long):String {
    val seconds=ms.coerceAtLeast(0)/1000
    return if(seconds>=3600)"${seconds/3600}h ${(seconds/60)%60}m ${seconds%60}s"else "${seconds/60}m ${seconds%60}s"
}

@Composable internal fun PlaybackOrderButton() {
    Action(playbackOrderIcon(),tr("Playback order: {0}", playbackOrderLabel()),color=MaterialTheme.colorScheme.primary) {command("dialog","playback-order")}
}

@Composable internal fun PlaybackOrderDialog() {
    TinglanAlertDialog(onDismissRequest={command("dialog-close")},title={Text(tr("Playback order"))},text={
        Column(verticalArrangement=Arrangement.spacedBy(8.dp)) {
            listOf(Triple("OFF","sequence",tr("Play in order")),Triple("ALL","repeat",tr("Repeat all")),Triple("ONE","repeat-one",tr("Repeat one")),Triple("SHUFFLE","shuffle",tr("Shuffle"))).forEach {(id,icon,label)->
                val selected=if(id=="SHUFFLE")model.shuffle else !model.shuffle && model.repeat==id
                SelectionRow(label,selected,icon=icon){command("playback-order",id)}
            }
        }
    },confirmButton={TextButton(onClick={command("dialog-close")}){Text(tr("Done"))}})
}

@Composable internal fun PlayingBars(modifier:Modifier=Modifier,playing:Boolean=true,animate:Boolean=true) {
    val phase=if(playing && animate && !model.reduced) {
        val transition=rememberInfiniteTransition(label="playing-bars")
        transition.animateFloat(0f,1f,infiniteRepeatable(tween(1200,easing=LinearEasing)),label="wave")
    }else rememberUpdatedState(.18f)
    val color=Color.White
    Canvas(modifier.size(24.dp).clearAndSetSemantics {}) {
        for(i in 0..3) {
            val h=playingBarHeight(phase.value,i)*size.height
            val x=size.width*(.2f+i*.2f)
            drawLine(color,Offset(x,(size.height-h)/2),Offset(x,(size.height+h)/2),size.width*.09f,StrokeCap.Round)
        }
    }
}

@Composable internal fun QueuePanel() {
    TinglanModalPanel(identity="queue",onDismissRequest={command("queue-close")},width=860.dp,
        shape=RoundedCornerShape(topStart=24.dp,topEnd=24.dp),color=MaterialTheme.colorScheme.background,
        alignment=Alignment.BottomCenter,fullHeight=true,fromBottom=true) {titleTag->QueueContent(titleTag)}
}

@Composable private fun QueueContent(titleTag:String) {
    val state=rememberLazyListState()
    val density=LocalDensity.current
    var dragKey by remember {mutableStateOf("")}
    var dragTarget by remember {mutableStateOf("")}
    var dragOffset by remember {mutableFloatStateOf(0f)}
    var headerDrag by remember {mutableFloatStateOf(0f)}
    val window=model.queue
    // Center only on opening or explicit location. Ordinary playback ticks do not fight scrolling.
    LaunchedEffect(model.queueFocus,model.queueOffset) {
        val index=window.indexOfFirst {it.queueKey==model.queueCurrentKey}
        val target=(if(index>=0)index else 0)+(if(model.queueOffset>0)1 else 0)
        snapshotFlow {state.layoutInfo}.first {it.viewportEndOffset>it.viewportStartOffset && it.totalItemsCount>target}
        state.scrollToItem(target)
        val layout=snapshotFlow {state.layoutInfo}.first {it.visibleItemsInfo.any {row->row.index==target}}
        val item=layout.visibleItemsInfo.first {it.index==target}
        state.scrollBy(queueCenterDelta(item.offset,item.size,layout.viewportStartOffset,layout.viewportEndOffset,layout.beforeContentPadding,layout.afterContentPadding))
    }
    LaunchedEffect(model.queueLocked) {if(model.queueLocked){dragKey="";dragTarget="";dragOffset=0f}}
    Column(Modifier.fillMaxSize().padding(top=8.dp)) {
        Column(Modifier.fillMaxWidth().guideTarget("queue-controls").pointerInput(Unit) {
            detectVerticalDragGestures(onDragStart={headerDrag=0f},onVerticalDrag={change,dy->if(dy>0 || headerDrag>0){change.consume();headerDrag=(headerDrag+dy).coerceAtLeast(0f)}},onDragEnd={if(headerDrag>with(density){56.dp.toPx()})command("queue-close");headerDrag=0f},onDragCancel={headerDrag=0f})
        }.padding(horizontal=20.dp,vertical=4.dp),verticalArrangement=Arrangement.spacedBy(4.dp)) {
            Box(Modifier.align(Alignment.CenterHorizontally).padding(bottom=4.dp).size(32.dp,4.dp).background(MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha=.25f),RoundedCornerShape(2.dp)))
            Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
                Action("down",tr("Close queue")){command("queue-close")}
                Column(Modifier.weight(1f).padding(horizontal=4.dp)) {
                    Text(tr("Play queue"),Modifier.testTag(titleTag).semantics {heading()},style=MaterialTheme.typography.titleMedium,fontWeight=FontWeight.SemiBold)
                    Text("${quantityLabel(model.queueTotal,"track")} · ${queueDurationLabel(model.queueDuration)}",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant,maxLines=1,overflow=TextOverflow.Ellipsis)
                }
                Action(if(model.queueLocked)"lock"else "unlock",if(model.queueLocked)tr("Unlock queue")else tr("Lock queue"),color=MaterialTheme.colorScheme.onSurfaceVariant){command("queue-lock")}
                Action("delete",tr("Clear other tracks"),color=MaterialTheme.colorScheme.error,enabled=!model.queueLocked && model.queueTotal>1){command("queue-clear")}
                PlaybackOrderButton()
            }
            model.current?.let {song->
                Row(Modifier.fillMaxWidth().padding(horizontal=4.dp,vertical=4.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                    Box(Modifier.clip(RoundedCornerShape(10.dp)).clickable {command("queue-locate")}.semantics {contentDescription=tr("Show current track")}) {Cover(song,44.dp)}
                    Column(Modifier.weight(1f).clip(RoundedCornerShape(8.dp)).clickable {command("queue-locate")},verticalArrangement=Arrangement.spacedBy(2.dp)) {
                        Text(song.title,style=MaterialTheme.typography.bodyLarge,fontWeight=FontWeight.Medium,maxLines=1,overflow=TextOverflow.Ellipsis)
                        Text(song.artist,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant,maxLines=1,overflow=TextOverflow.Ellipsis)
                    }
                    Action(if(song.favorite)"liked"else "heart",tr("Favorite current track"),color=if(song.favorite)MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant){command("favorite",song.id)}
                    Action("more",tr("Current track actions")){command("song-menu",payload("id" to song.id,"context" to "queue","queueKey" to model.queueCurrentKey))}
                }
            }
        }
        LazyColumn(state=state,modifier=Modifier.weight(1f).fillMaxWidth().semantics {contentDescription=tr("Queue list")},contentPadding=PaddingValues(start=20.dp,end=20.dp,top=4.dp,bottom=12.dp),verticalArrangement=Arrangement.spacedBy(4.dp)) {
            if(window.isEmpty())item {EmptyState(tr("Queue is empty"),tr("Play a track or playlist to add music here."),"queue")}
            if(model.queueOffset>0)item(key="queue-before"){TextButton(onClick={command("queue-before")},modifier=Modifier.fillMaxWidth()){Text(tr("Show earlier tracks"))}}
            items(window,key={it.queueKey}) {song->
                val swipe=rememberSwipeToDismissBoxState(confirmValueChange={value->
                    if(value==SwipeToDismissBoxValue.EndToStart && !model.queueLocked){command("queue-dismiss",payload("id" to song.id,"key" to song.queueKey));false}else value==SwipeToDismissBoxValue.Settled
                })
                SwipeToDismissBox(state=swipe,modifier=Modifier.zIndex(if(dragKey==song.queueKey)1f else 0f),enableDismissFromStartToEnd=false,enableDismissFromEndToStart=!model.queueLocked && dragKey.isEmpty(),backgroundContent={
                    if(swipe.dismissDirection!=SwipeToDismissBoxValue.Settled)Box(Modifier.fillMaxSize().clip(RoundedCornerShape(16.dp)).background(MaterialTheme.colorScheme.errorContainer).padding(end=18.dp),contentAlignment=Alignment.CenterEnd){Glyph("delete",color=MaterialTheme.colorScheme.onErrorContainer)}
                }) {
                    QueueTrackRow(song,dragKey==song.queueKey,dragTarget==song.queueKey,dragOffset,
                        onDragStart={dragKey=song.queueKey;dragTarget=song.queueKey;dragOffset=0f},
                        onDrag={dy->
                            dragOffset+=dy
                            val origin=state.layoutInfo.visibleItemsInfo.firstOrNull {it.key==song.queueKey}
                            if(origin!=null){val y=origin.offset+origin.size/2+dragOffset;state.layoutInfo.visibleItemsInfo.filter {it.key is String && (it.key as String).startsWith("q")}.minByOrNull {kotlin.math.abs(it.offset+it.size/2-y)}?.let {dragTarget=it.key as String}}
                        },
                        onDragEnd={
                            if(dragTarget.isNotEmpty() && dragTarget!=dragKey)command("queue-reorder",payload("id" to song.id,"key" to dragKey,"destinationKey" to dragTarget))
                            dragKey="";dragTarget="";dragOffset=0f
                        },onDragCancel={dragKey="";dragTarget="";dragOffset=0f})
                }
            }
            if(model.queueOffset+window.size<model.queueTotal)item(key="queue-after"){TextButton(onClick={command("queue-after")},modifier=Modifier.fillMaxWidth()){Text(tr("Show later tracks"))}}
        }
        if(model.queueUndo.isNotEmpty())Surface(color=MaterialTheme.colorScheme.inverseSurface,shape=RoundedCornerShape(16.dp),modifier=Modifier.fillMaxWidth().padding(16.dp,8.dp)) {
            Row(Modifier.padding(start=16.dp,end=6.dp),verticalAlignment=Alignment.CenterVertically) {
                Text(model.queueUndo,Modifier.weight(1f),color=MaterialTheme.colorScheme.inverseOnSurface,style=MaterialTheme.typography.bodyMedium,maxLines=2)
                TextButton(onClick={command("queue-undo")},enabled=!model.queueLocked){Text(tr("Undo"),color=if(model.queueLocked)MaterialTheme.colorScheme.inverseOnSurface.copy(alpha=.4f)else MaterialTheme.colorScheme.inversePrimary)}
            }
        }
    }
}

@Composable private fun QueueTrackRow(song:Song,dragging:Boolean,targeted:Boolean,dragOffset:Float,onDragStart:()->Unit,onDrag:(Float)->Unit,onDragEnd:()->Unit,onDragCancel:()->Unit) {
    val active=song.queueKey==model.queueCurrentKey
    FlatSelectableSurface(active,RoundedCornerShape(16.dp),if(targeted && !dragging)MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.background,
        modifier=Modifier.fillMaxWidth().semantics {if(active)stateDescription=if(model.status=="playing")tr("Now playing")else tr("Paused")}.graphicsLayer {if(dragging){translationY=dragOffset;alpha=.8f}},
        onClick={command("queue-play",payload("id" to song.id,"key" to song.queueKey))}) {
        Row(Modifier.fillMaxWidth().padding(start=8.dp,end=0.dp,top=8.dp,bottom=8.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
            Box(Modifier.clip(RoundedCornerShape(10.dp))) {
                Cover(song,48.dp)
                if(active)Box(Modifier.matchParentSize().background(Color.Black.copy(alpha=.35f)),contentAlignment=Alignment.Center){PlayingBars(playing=model.status=="playing",animate=model.dialog.isEmpty())}
            }
            Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(3.dp)) {
                Text(song.title,style=MaterialTheme.typography.bodyLarge,fontWeight=FontWeight.Medium,color=if(active)MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,maxLines=1,overflow=TextOverflow.Ellipsis)
                Text(song.artist+(if(song.duration>0)" · ${timestamp(song.duration)}"else ""),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant,maxLines=1,overflow=TextOverflow.Ellipsis)
            }
            Row {
                Action("more",tr("More actions: {0}", song.title),color=MaterialTheme.colorScheme.onSurfaceVariant){command("song-menu",payload("id" to song.id,"context" to "queue","queueKey" to song.queueKey))}
                if(!model.queueLocked)IconButton(onClick={},modifier=Modifier.size(44.dp).pointerInput(song.queueKey) {
                    detectDragGestures(onDragStart={onDragStart()},onDrag={change,amount->change.consume();onDrag(amount.y)},onDragEnd=onDragEnd,onDragCancel=onDragCancel)
                }.semantics {
                    contentDescription=tr("Drag to reorder: {0}", song.title)
                    customActions=listOf(CustomAccessibilityAction(tr("Move forward")){command("queue-nudge",payload("id" to song.id,"key" to song.queueKey,"delta" to "-1"));true},CustomAccessibilityAction(tr("Move backward")){command("queue-nudge",payload("id" to song.id,"key" to song.queueKey,"delta" to "1"));true})
                }){Glyph("drag",color=MaterialTheme.colorScheme.onSurfaceVariant)}
            }
        }
    }
}
