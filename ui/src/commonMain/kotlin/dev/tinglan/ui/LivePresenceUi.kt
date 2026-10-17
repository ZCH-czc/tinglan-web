package dev.tinglan.ui

import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*

internal fun roomForCreator(id:String,source:String="bili"):String {
    if(source!="bili")return ""
    return when(model.presenceInfo.scope) {"author"->if(model.presenceInfo.id==id)model.presenceInfo.liveRoomId else "";"following"->model.liveCreators.firstOrNull {it.id==id}?.roomId.orEmpty();else->""}
}

@Composable internal fun LiveCreatorAvatar(song:Song,size:Dp,roomId:String="",onAuthor:(()->Unit)?=null) {
    val live=roomId.isNotEmpty()
    val color=MaterialTheme.colorScheme.primary
    val pulse=if(live && model.presenceAnimating && !model.reduced) rememberInfiniteTransition(label="live-author").animateFloat(0f,1f,infiniteRepeatable(tween(1700,easing=LinearEasing)),label="live-wave") else remember {mutableStateOf(0f)}
    Box(Modifier.size(size+10.dp).clip(CircleShape).clickable(enabled=live || onAuthor!=null) {if(live)command("live-open",roomId)else onAuthor?.invoke()}.semantics {contentDescription=if(live)"${song.title} Live now. Open the avatar to watch" else "${song.title} avatar"},contentAlignment=Alignment.Center) {
        if(live)Canvas(Modifier.matchParentSize()) {
            val phase=pulse.value
            drawCircle(color.copy(alpha=.7f),radius=(this.size.minDimension-8.dp.toPx())/2,style=Stroke(1.4.dp.toPx()))
            if(phase>0f)drawCircle(color.copy(alpha=(1f-phase)*.35f),radius=(this.size.minDimension-8.dp.toPx())/2+phase*3.dp.toPx(),style=Stroke(1.dp.toPx()))
        }
        Box(Modifier.size(size).clip(CircleShape)) {Cover(song,size)}
    }
}

@Composable internal fun LiveCreatorRow(creator:LiveCreator) {
    Surface(shape=RoundedCornerShape(18.dp),color=MaterialTheme.colorScheme.surfaceContainer.copy(alpha=.7f)) {
        Row(Modifier.fillMaxWidth().padding(14.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
            LiveCreatorAvatar(Song(creator.avatarKey,creator.name,"",cover=creator.avatarKey.isNotEmpty(),source="bili"),54.dp,creator.roomId)
            Column(Modifier.weight(1f).clip(RoundedCornerShape(10.dp)).clickable {command("creator-direct",payload("id" to creator.id,"source" to "bili"))}.padding(vertical=4.dp),verticalArrangement=Arrangement.spacedBy(5.dp)) {
                Text(creator.name,fontWeight=FontWeight.SemiBold,maxLines=1,overflow=TextOverflow.Ellipsis)
                Text(creator.title.ifEmpty {"Live now"},style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant,maxLines=2,overflow=TextOverflow.Ellipsis)
                Text("Live · Open the avatar to watch",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.primary)
            }
            Action("play","Watch ${creator.name} live stream") {command("live-open",creator.roomId)}
        }
    }
}

@Composable internal fun PresenceStatus(info:PresenceInfo,author:Boolean=false) {
    if(info.loading)Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)) {
        CircularProgressIndicator(Modifier.size(14.dp),strokeWidth=1.5.dp)
        Text("Checking live status…",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
    }
    if(info.warning.isNotBlank())TextButton(onClick={command("presence-refresh")},enabled=!info.loading) {Text("${info.warning} · Retry",style=MaterialTheme.typography.bodySmall)}
    else if(info.fetchedAt>0 && !info.loading)Text(if(author && info.liveRoomId.isEmpty())if(info.known)"Offline · Refresh to check again" else "Live status unavailable" else "Showing previous live status · Refresh to update",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
}
