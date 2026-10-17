@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
package dev.tinglan.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

@Immutable data class CacheNotice(val token:String="",val used:Long=0,val limit:Long=0)
@Immutable data class CacheTask(val id:String,val title:String,val mode:String="download",val status:String="queued",val progress:Float=0f,val done:Long=0,val total:Long=0,val error:String="",val warning:String="")
@Immutable data class CacheInfo(val autoEnabled:Boolean=false,val limitMb:Int=1024,val keepFavorites:Boolean=true,val loading:Boolean=false,val cleaning:Boolean=false,val warning:String="",val automaticBytes:Long=0,val downloadBytes:Long=0,val localBytes:Long=0,val artworkBytes:Long=0,val usage:Long=0,val quota:Long=0,val automaticCount:Int=0,val downloadCount:Int=0,val localCount:Int=0,val filter:String="all",val page:Int=0,val pages:Int=1,val count:Int=0,val notice:CacheNotice?=null)
internal fun cacheSize(bytes:Long):String = if(bytes>=1_073_741_824L) "${(bytes/107374182.4).toInt()/10.0} GB" else if(bytes>=1_048_576L) "${(bytes/104857.6).toInt()/10.0} MB" else "${(bytes.coerceAtLeast(0)/102.4).toInt()/10.0} KB"
private fun budgetLabel(mb:Int)=when(mb){-1->"No app limit";0->"Disable automatic cache";else->cacheSize(mb.toLong()*1_048_576)}
internal fun CacheTask.active()=status in listOf("queued","preparing","downloading","saving")

@Composable internal fun CacheDownloadRing(task:CacheTask) {
    Box(Modifier.size(26.dp).semantics {contentDescription="Download ${task.title}, "+if(task.total>0)"${(task.progress*100).toInt()}%" else "Preparing"},contentAlignment=Alignment.Center) {
        if(task.total>0)CircularProgressIndicator(progress={task.progress.coerceIn(0f,1f)},modifier=Modifier.fillMaxSize(),strokeWidth=2.dp)
        else if(model.reduced)Glyph("download",Modifier.size(22.dp),MaterialTheme.colorScheme.primary)
        else CircularProgressIndicator(Modifier.fillMaxSize(),strokeWidth=2.dp)
        if(task.total>0)Glyph("download",Modifier.size(14.dp),MaterialTheme.colorScheme.primary)
    }
}
@Composable internal fun CachePressureBanner() {
    val notice=model.cacheInfo.notice ?: return
    Surface(shape=RoundedCornerShape(18.dp),color=MaterialTheme.colorScheme.secondaryContainer,modifier=Modifier.widthIn(max=640.dp).fillMaxWidth().padding(horizontal=12.dp)) {
        Row(Modifier.padding(start=14.dp,end=4.dp,top=4.dp,bottom=4.dp).semantics {liveRegion=LiveRegionMode.Polite},verticalAlignment=Alignment.CenterVertically) {
            Text("Cache nearly full\n${cacheSize(notice.used)} / ${cacheSize(notice.limit)}",Modifier.weight(1f),style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSecondaryContainer)
            TextButton(onClick={command("cache-open")}) {Text("Manage")}
            TextButton(onClick={command("cache-pressure-ack",notice.token)}) {Text("Got it")}
        }
    }
}
@Composable private fun CacheCard(content:@Composable ColumnScope.()->Unit) {
    Surface(Modifier.fillMaxWidth(),shape=RoundedCornerShape(20.dp),color=MaterialTheme.colorScheme.surfaceContainer) {Column(Modifier.padding(18.dp),verticalArrangement=Arrangement.spacedBy(12.dp),content=content)}
}
@Composable internal fun CachePage(data:UiModel) {
    val info=data.cacheInfo
    // Active jobs are global and deliberately absent from retained page snapshots.
    val tasks=model.cacheTasks
    val state=remember(info.filter,info.page){LazyListState()}
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(start=10.dp,end=18.dp,top=10.dp,bottom=6.dp),verticalAlignment=Alignment.CenterVertically) {
            Action("back","Back") {command("page-back")}
            Text("Downloads & cache",Modifier.weight(1f),style=MaterialTheme.typography.titleLarge,fontWeight=FontWeight.Bold)
            if(info.loading)CircularProgressIndicator(Modifier.size(22.dp),strokeWidth=2.dp) else Action("refresh","Refresh storage usage") {command("cache-refresh")}
        }
        LazyColumn(state=state,contentPadding=PaddingValues(start=20.dp,end=20.dp,top=12.dp,bottom=180.dp),verticalArrangement=Arrangement.spacedBy(14.dp)) {
            item {CacheCard {
                Text("Stored in this browser",fontWeight=FontWeight.SemiBold)
                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(10.dp)) {
                    listOf(Triple("Offline downloads",info.downloadBytes,info.downloadCount),Triple("Automatic cache",info.automaticBytes,info.automaticCount),Triple("Local imports",info.localBytes,info.localCount)).forEach {(label,bytes,count)->
                        Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)) {Text(cacheSize(bytes),style=MaterialTheme.typography.titleMedium,fontWeight=FontWeight.Bold,color=MaterialTheme.colorScheme.primary);Text("$label · $count tracks",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
                    }
                }
                Text("Artwork ${cacheSize(info.artworkBytes)}"+(if(info.quota>0)" · Browser storage used ${cacheSize(info.usage)} / ${cacheSize(info.quota)}" else ""),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                Text("Downloads and local imports are kept. Automatic cleanup removes cached playback audio only; metadata, lyrics, artwork, and notes remain available.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            }}
            item {CacheCard {
                Row(verticalAlignment=Alignment.CenterVertically) {Column(Modifier.weight(1f)) {Text("Automatically cache playing tracks",fontWeight=FontWeight.SemiBold);Text("Downloads the full audio after playback stabilizes. Uses additional data.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)};Switch(checked=info.autoEnabled,onCheckedChange={command("cache-auto",it.toString())},enabled=!info.cleaning && info.limitMb!=0)}
                Text("Stops when you change tracks, pause, or hide the page. Disabled on slow connections and in data saver mode.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                Row(verticalAlignment=Alignment.CenterVertically) {Text("Automatic cache limit",Modifier.weight(1f));TextButton(onClick={command("dialog","cache-budget")},enabled=!info.cleaning) {Text(budgetLabel(info.limitMb));Glyph("down",Modifier.padding(start=6.dp).size(16.dp))}}
                if(info.limitMb>0)LinearProgressIndicator(progress={(info.automaticBytes.toFloat()/(info.limitMb.toLong()*1_048_576)).coerceIn(0f,1f)},modifier=Modifier.fillMaxWidth().height(3.dp))
                Row(verticalAlignment=Alignment.CenterVertically) {Column(Modifier.weight(1f)) {Text("Keep favorites in automatic cache");Text("The current and next track are always protected.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)};Switch(checked=info.keepFavorites,onCheckedChange={command("cache-keep-favorites",it.toString())},enabled=!info.cleaning)}
                Row {TextButton(onClick={command("cache-clean-open")},enabled=info.automaticCount>0 && !info.cleaning) {Text(if(info.cleaning)"Cleaning up…" else "Clear automatic cache")};TextButton(onClick={command("cache-catalog-clean")},enabled=!info.cleaning) {Text("Clear search cache")}}
            }}
            if(info.warning.isNotEmpty())item {Text(info.warning,color=MaterialTheme.colorScheme.error,style=MaterialTheme.typography.bodySmall)}
            if(tasks.isNotEmpty()) {
                item {Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
                    Text("Download tasks",Modifier.weight(1f),style=MaterialTheme.typography.titleMedium,fontWeight=FontWeight.SemiBold)
                    if(tasks.any {it.status=="error"})TextButton(onClick={command("cache-retry-failed")}) {Text("Retry failed")}
                    if(tasks.any {it.active()})TextButton(onClick={command("cache-cancel-all")}) {Text("Cancel all")}
                }}
                items(tasks,key={"task:"+it.id}) {task->CacheTaskRow(task)}
                item {Text("Downloads run in the background. Supported browsers can continue after closing this page; otherwise keep it open. Keep the companion running. Interrupted tasks can be retried.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
            }
            item {Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)) {listOf("all" to "Saved audio","download" to "Offline downloads","automatic" to "Automatic cache").forEach {(id,label)->FilterChip(selected=info.filter==id,onClick={command("cache-filter",id)},label={Text(label)})}}}
            items(data.cacheItems,key={"audio:"+it.id}) {song->Column(verticalArrangement=Arrangement.spacedBy(2.dp)) {SongRow(song,"cache");Row(Modifier.fillMaxWidth().padding(start=12.dp),verticalAlignment=Alignment.CenterVertically) {Text((if(song.cacheMode=="automatic")"Automatic cache" else "Offline downloads")+" · "+cacheSize(song.fileBytes),Modifier.weight(1f),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant);if(song.cacheMode=="automatic")TextButton(onClick={command("cache",song.id)}) {Text("Keep download")};TextButton(onClick={command("cache-clean-open",song.id)},enabled=!info.cleaning) {Text("Free audio space")}}}}
            if(data.cacheItems.isEmpty() && !info.loading)item {EmptyState("No online audio saved yet","Choose offline download from a track menu, or enable automatic caching above.","download")}
            if(info.pages>1)item {Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.Center,verticalAlignment=Alignment.CenterVertically) {Action("back","Previous cache page",enabled=info.page>0) {command("cache-page",(info.page-1).toString())};Text("${info.page+1} / ${info.pages}",Modifier.padding(horizontal=20.dp));Action("next","Next cache page",enabled=info.page+1<info.pages) {command("cache-page",(info.page+1).toString())}}}
        }
    }
}
@Composable private fun CacheTaskRow(task:CacheTask) {
    Surface(Modifier.fillMaxWidth(),shape=RoundedCornerShape(18.dp),color=MaterialTheme.colorScheme.surfaceContainerLow) {
        Row(Modifier.padding(start=14.dp,end=8.dp,top=10.dp,bottom=10.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
            if(task.active())CacheDownloadRing(task) else Glyph(if(task.status=="complete")"check" else "download",Modifier.size(26.dp),if(task.status=="error")MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary)
            Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)) {
                Text(task.title,maxLines=1,overflow=TextOverflow.Ellipsis,fontWeight=FontWeight.SemiBold)
                if(task.active() && task.warning.isNotBlank())Text(task.warning,style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.primary)
                Text(when(task.status){"queued"->"Queued";"preparing"->"Resolving source";"saving"->"Saving audio, lyrics, and artwork";"downloading"->cacheSize(task.done)+(if(task.total>0)" / ${cacheSize(task.total)}" else "");"complete"->if(task.warning.isNotEmpty())task.warning else "Saved";"cancelled"->"Cancelled";else->task.error.ifBlank {"Download incomplete"}},style=MaterialTheme.typography.bodySmall,color=if(task.status=="error")MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,maxLines=3,overflow=TextOverflow.Ellipsis)
            }
            if(task.active())Action("close","Cancel download ${task.title}") {command("cache-cancel",task.id)} else if(task.status in listOf("cancelled","error"))Action("refresh","Download again ${task.title}") {command("cache-retry",task.id)}
        }
    }
}
@Composable internal fun CacheDialog() {
    if(model.dialog=="cache-budget")TinglanAlertDialog(onDismissRequest={command("dialog-close")},title={Text("Automatic cache capacity")},text={Column(Modifier.heightIn(max=460.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(4.dp)) {
        Text("Lowering the limit removes older automatic audio caches. Downloads, imports, and protected tracks are kept.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        listOf(0,256,512,1024,2048,4096,-1).forEach {mb->SelectionRow(budgetLabel(mb),model.cacheInfo.limitMb==mb,enabled=!model.cacheInfo.cleaning){command("cache-limit",mb.toString())}}
    }},confirmButton={TextButton(onClick={command("dialog-close")}) {Text("Done")}})
    else TinglanAlertDialog(onDismissRequest={if(!model.cacheInfo.cleaning)command("dialog-close")},title={Text(if(model.target=="automatic")"Clear automatic cache?" else "Remove this saved audio?")},text={Text(if(model.target=="automatic")"Free automatic audio caches according to retention rules. Downloads, imports, and the current and next track are kept. Lyrics, artwork, and notes are unaffected." else "Remove only this online track’s saved audio. Metadata and edits are kept. Playback will need a connection. The current and next track cannot be removed.")},confirmButton={TextButton(onClick={command("cache-clean-confirm",model.target)},enabled=!model.cacheInfo.cleaning) {Text(if(model.cacheInfo.cleaning)"Cleaning up…" else "Free audio space")}},dismissButton={TextButton(onClick={command("dialog-close")},enabled=!model.cacheInfo.cleaning) {Text("Cancel")}})
}
