package dev.tinglan.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*

/** A shared self-drawn selector for both the audio player and transparent video control scene. */
@Composable internal fun BilibiliContextDialog() {
    val info=model.biliInfo
    var group by remember(info?.bvid) {mutableStateOf(if(model.biliParts.size>1 || info?.collectionId.isNullOrEmpty())"parts" else "collection")}
    val current=model.current?.id.orEmpty()
    val first=model.biliParts.firstOrNull()
    val activePart=model.biliParts.firstOrNull {it.song.id==current || it==first && current.endsWith("_cid_${it.cid}")}
    val songs=if(group=="parts")model.biliParts.map {it.song} else model.biliCollectionSongs
    val listState=rememberLazyListState()
    LaunchedEffect(info?.bvid,group,songs.size) {
        val index=if(group=="parts")songs.indexOfFirst {it.id==activePart?.song?.id} else songs.indexOfFirst {current==it.id || current.startsWith(it.id+"_cid_")}
        if(index>=0)listState.scrollToItem(index)
    }
    TinglanAlertDialog(onDismissRequest={command("dialog-close")},shape=RoundedCornerShape(26.dp),title={Text(info?.title?.ifEmpty {"Episodes & collections"} ?: "Episodes & collections",maxLines=2,overflow=TextOverflow.Ellipsis)},text={
        Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(10.dp)) {
            Row(horizontalArrangement=Arrangement.spacedBy(12.dp),verticalAlignment=Alignment.CenterVertically) {
                TextButton(onClick={group="parts"}) {Text("Part P · ${model.biliParts.size}",fontWeight=if(group=="parts")FontWeight.Bold else FontWeight.Normal)}
                if(!info?.collectionId.isNullOrEmpty())TextButton(onClick={group="collection"}) {Text("Collection · ${info.collectionTotal}",fontWeight=if(group=="collection")FontWeight.Bold else FontWeight.Normal)}
                Spacer(Modifier.weight(1f))
                IconButton(onClick={command("bili-context-refresh")},enabled=info?.loading!=true,modifier=Modifier.semantics {contentDescription="Refresh episodes"}) {Glyph("refresh")}
            }
            if(info?.warning?.isNotEmpty()==true)Text(info.warning,color=MaterialTheme.colorScheme.onSurfaceVariant,style=MaterialTheme.typography.bodySmall)
            if(group=="collection") {
                Text(info?.collectionTitle.orEmpty(),fontWeight=FontWeight.SemiBold)
                if(info?.partial==true)Text("Only part of this collection is available here. Open the full collection for more.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                TextButton(onClick={command("bili-context-collection")}) {Text("Open full collection / Save to library")}
            }
            if(info?.loading==true && songs.isEmpty())LinearProgressIndicator(Modifier.fillMaxWidth())
            LazyColumn(state=listState,modifier=Modifier.fillMaxWidth().heightIn(max=360.dp),verticalArrangement=Arrangement.spacedBy(6.dp)) {
                items(songs,key={it.id}) {song->
                    val active=if(group=="parts")song.id==activePart?.song?.id else current==song.id || current.startsWith(song.id+"_cid_")
                    Surface(onClick={command("bili-context-play",payload("id" to song.id,"group" to group))},shape=RoundedCornerShape(16.dp),color=if(active)MaterialTheme.colorScheme.primary.copy(alpha=.1f)else MaterialTheme.colorScheme.surfaceContainer) {
                        Row(Modifier.fillMaxWidth().padding(12.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                            if(group=="collection")Cover(song,42.dp)
                            Column(Modifier.weight(1f)) {
                                Text(song.title,maxLines=2,overflow=TextOverflow.Ellipsis,fontWeight=if(active)FontWeight.SemiBold else FontWeight.Normal)
                                Text(timestamp(song.duration),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            if(active)Glyph(if(model.status=="playing")"pause" else "check",color=MaterialTheme.colorScheme.primary)
                        }
                    }
                }
                if(info?.loading!=true && songs.isEmpty())item {Text("No available content. Refresh to retry.",Modifier.padding(vertical=20.dp),color=MaterialTheme.colorScheme.onSurfaceVariant)}
            }
        }
    },confirmButton={TextButton(onClick={command("dialog-close")}) {Text("Close")}})
}
