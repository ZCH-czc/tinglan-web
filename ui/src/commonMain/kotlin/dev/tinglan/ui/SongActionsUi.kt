package dev.tinglan.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.*
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/** The native player menu's bottom sheet layout, shared by library, player and queue. */
@Composable internal fun SongActionsSheet(song:Song?,id:String,key:String) {
    val queued=model.menuContext=="queue"
    val editable=queued && !model.queueLocked && key.isNotEmpty()
    val at=model.queue.firstOrNull {it.queueKey==key}?.queueIndex ?: -1
    fun queueRequest(action:String,delta:String="")=command(action,payload("id" to id,"key" to key,"delta" to delta))
    TinglanModalPanel(identity="song-menu|$id|$key",onDismissRequest={command("dialog-close")},width=640.dp,
        alignment=Alignment.BottomCenter,fromBottom=true,shape=RoundedCornerShape(topStart=24.dp,topEnd=24.dp),color=MaterialTheme.colorScheme.background) {titleTag->
        Column(Modifier.padding(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
            Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                Cover(song,48.dp)
                Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(3.dp)) {
                    Text(song?.title ?: "Track actions",Modifier.testTag(titleTag).semantics {heading()},style=MaterialTheme.typography.titleMedium,fontWeight=FontWeight.SemiBold,maxLines=2,overflow=TextOverflow.Ellipsis)
                    Text(song?.artist.orEmpty(),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant,maxLines=1,overflow=TextOverflow.Ellipsis)
                }
                Action("close","Close track actions"){command("dialog-close")}
            }
            Column(Modifier.weight(1f,fill=false).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(2.dp)) {
                if(queued && model.queueLocked)Text("Queue editing is locked. Unlock it at the top of the queue.",Modifier.padding(12.dp),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                if(queued) {
                    SongAction("Play next","next",editable && key!=model.queueCurrentKey){queueRequest("queue-play-next")}
                    SongAction("Move earlier in queue","up",editable && at>0){queueRequest("queue-move","-1")}
                    SongAction("Move later in queue","down",editable && at>=0 && at<model.queueTotal-1){queueRequest("queue-move","1")}
                    SongAction("Remove from queue","delete",editable,color=MaterialTheme.colorScheme.error){queueRequest("queue-remove")}
                    HorizontalDivider(Modifier.padding(12.dp,6.dp),color=MaterialTheme.colorScheme.onSurface.copy(alpha=.06f))
                }else {
                    SongAction("Play next","next"){command("queue-next",id)}
                    SongAction("Add to play queue","queue"){command("queue-add",id)}
                }
                SongAction(if(song?.favorite==true)"Remove favorite"else "Favorite track",if(song?.favorite==true)"liked"else "heart"){command("favorite",id)}
                SongAction("Add to local playlist","playlist"){command("dialog","playlist-add")}
                if(model.menuContext.startsWith("playlist:"))SongAction("Remove from this playlist","delete"){command("playlist-remove-song")}
                if(song?.creatorId?.isNotEmpty()==true)SongAction("Open artist page","artist"){command("creator-open",id)}
                if(song!=null && song.source!="local")SongAction("View comments","comment"){command("comments-open",id)}
                if(song?.source=="bili" && id==model.current?.id)SongAction("Episodes & video collections","playlist"){command("bili-context-open")}
                if(song?.source=="bili")SongAction("Bilibili Likes & collections","thumb"){command("bili-actions-open",id)}
                SongAction("Music notes","note"){command("note-open",id)}
                SongAction("Edit / Copy / Export lyrics","lyrics"){command("lyrics-edit",id)}
                SongAction("Edit track details","music"){command("metadata-open")}
                SongAction("Change artwork","artwork"){command("artwork-import",id)}
                if(song!=null && song.source!="local") {
                    SongAction(if(song.cacheMode=="download")"Check offline download"else "Offline download (keep audio) ","download"){command("cache",id)}
                    if(song.cached)SongAction("Remove saved audio","folder"){command("cache-clean-open",id)}
                }
                SongAction("Manage downloads & cache","folder"){command("cache-open")}
                SongAction("Remove from library","delete",color=MaterialTheme.colorScheme.error){command("dialog","remove")}
            }
            if(model.dialogError.isNotEmpty())Text(model.dialogError,Modifier.semantics {liveRegion=LiveRegionMode.Polite},style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.error)
            if(model.toast.isNotEmpty())Text(model.toast,Modifier.semantics {liveRegion=LiveRegionMode.Polite},style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.primary)
        }
    }
}

@Composable private fun SongAction(label:String,icon:String,enabled:Boolean=true,color:Color=MaterialTheme.colorScheme.onSurface,onClick:()->Unit) {
    FlatSelectableSurface(false,RoundedCornerShape(12.dp),Color.Transparent,enabled=enabled,onClick=onClick,modifier=Modifier.fillMaxWidth()) {
        Row(Modifier.heightIn(min=52.dp).padding(horizontal=12.dp,vertical=10.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(16.dp)) {
            Glyph(icon,color=if(enabled)color else color.copy(alpha=.35f))
            Text(label,style=MaterialTheme.typography.bodyLarge,color=if(enabled)color else color.copy(alpha=.4f))
        }
    }
}
