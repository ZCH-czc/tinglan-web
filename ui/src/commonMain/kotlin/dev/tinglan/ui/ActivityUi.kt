package dev.tinglan.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

@Composable internal fun ActivityCard(activity:Activity,detail:Boolean=false,nested:Boolean=false) {
    val open:()->Unit={command("dynamic-open",activity.id)}
    val scheme=MaterialTheme.colorScheme
    Surface(shape=RoundedCornerShape(if(nested)16.dp else 22.dp),color=if(nested)scheme.onSurface.copy(alpha=.035f)else scheme.surfaceContainerLow) {
        Column(Modifier.fillMaxWidth().padding(if(nested)14.dp else 18.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
            if(activity.pinned)Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(7.dp)) {Glyph("pin",Modifier.size(16.dp),scheme.primary);Text("Pinned post",style=MaterialTheme.typography.labelMedium,color=scheme.primary)}
            Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(10.dp)) {
                Row(Modifier.weight(1f),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(10.dp)) {
                    val room=roomForCreator(activity.authorId)
                    val author:()->Unit={command("creator-direct",payload("id" to activity.authorId,"source" to "bili"))}
                    LiveCreatorAvatar(Song(activity.avatarKey,activity.author,"",cover=activity.avatarKey.isNotEmpty(),source="bili"),if(nested)32.dp else 44.dp,room,author)
                    Column(Modifier.weight(1f).clip(RoundedCornerShape(10.dp)).clickable {author()},verticalArrangement=Arrangement.spacedBy(4.dp)) {Text(activity.author,fontWeight=FontWeight.SemiBold,maxLines=1,overflow=TextOverflow.Ellipsis);if(room.isNotEmpty())Text("Live · Open the avatar to watch",style=MaterialTheme.typography.labelSmall,color=scheme.primary);if(activity.atText.isNotEmpty())Text(activity.atText,style=MaterialTheme.typography.labelSmall,color=scheme.onSurfaceVariant)}
                }
                if(!detail)Action("chevron","Open post") {open()}
            }
            if(activity.title.isNotEmpty())Text(activity.title,Modifier.clickable(enabled=!detail) {open()},fontWeight=FontWeight.SemiBold,maxLines=if(detail)Int.MAX_VALUE else 2,overflow=TextOverflow.Ellipsis)
            if(activity.text.isNotEmpty())RichContentText(activity.text,activity.emotes,maxLines=if(detail)Int.MAX_VALUE else 5,onClick=if(detail)null else open)
            if(activity.pictures.isNotEmpty())Column(verticalArrangement=Arrangement.spacedBy(8.dp)) {
                activity.pictures.chunked(3).forEach {line->Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                    line.forEach {image->BoxWithConstraints(Modifier.weight(1f).aspectRatio(1f).clip(RoundedCornerShape(12.dp)).clickable {openPictures(activity.pictures,activity.pictures.indexOf(image))}.semantics {contentDescription="View post images ${activity.pictures.indexOf(image)+1}, Total ${activity.pictures.size} images"}) {ContentPicture(image,maxWidth)}}
                    repeat(3-line.size) {Spacer(Modifier.weight(1f))}
                }}
            }
            activity.song?.let {SongRow(it,"activities")}
            if(activity.original!=null)ActivityCard(activity.original,nested=true)
            if(activity.originalUnavailable)Text("The original post was removed or is unavailable",style=MaterialTheme.typography.bodySmall,color=scheme.onSurfaceVariant)
            if(activity.liveRoomId.isNotEmpty())TextButton(onClick={command("live-open",activity.liveRoomId)}) {Glyph("bili",Modifier.size(18.dp),sourceColor("bili"));Spacer(Modifier.width(8.dp));Text("Watch live")}
            if(!nested)Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                Text("likes ${activity.likes} · reposts ${activity.reposts}",Modifier.weight(1f),style=MaterialTheme.typography.labelSmall,color=scheme.onSurfaceVariant)
                TextButton(onClick={command("dynamic-comments",activity.id)},enabled=activity.canComment) {Glyph("comment",Modifier.size(17.dp),if(activity.canComment)scheme.primary else scheme.onSurfaceVariant);Spacer(Modifier.width(6.dp));Text("${activity.comments} comments")}
            }
            if(detail && !activity.canComment && !nested)Text("Comments are not available for this post",style=MaterialTheme.typography.bodySmall,color=scheme.onSurfaceVariant)
        }
    }
}

internal fun LazyListScope.activityItems(data:UiModel) {
    val info=data.feedInfo
    if(info.warning.isNotEmpty())item {ErrorCard(info.warning) {command("feed-refresh")}}
    if(info.loading && data.activities.isEmpty())item {LoadingRows()}
    items(data.activities,key={"dynamic-${it.id}"}) {ActivityCard(it)}
    if(!info.loading && data.activities.isEmpty() && info.warning.isEmpty())item {EmptyState("No posts yet","Refresh to check for new content.","feed")}
    if(info.notice.isNotEmpty())item {Text(info.notice,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
    if(info.next.isNotEmpty())item {TextButton(onClick={command("feed-more")},enabled=!info.loading,modifier=Modifier.fillMaxWidth()) {Text("More posts")}}
    if(info.loading && data.activities.isNotEmpty())item {LinearProgressIndicator(Modifier.fillMaxWidth())}
}

@Composable internal fun DynamicPage(data:UiModel) {
    val info=data.dynamicInfo
    Column(Modifier.fillMaxSize()) {
        Box(Modifier.padding(start=12.dp,end=16.dp,top=10.dp,bottom=8.dp)) {ContentHeading("Post details","dynamic-refresh",info.loading)}
        LazyColumn(state=retainedContentScroll(data.viewKey),modifier=Modifier.fillMaxSize(),contentPadding=PaddingValues(start=24.dp,end=24.dp,bottom=190.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
            if(info.warning.isNotEmpty())item {ErrorCard(info.warning) {command("dynamic-refresh")}}
            if(info.loading && data.activityDetails.isEmpty())item {LoadingRows()}
            items(data.activityDetails,key={it.id}) {ActivityCard(it,detail=true)}
            if(info.loading && data.activityDetails.isNotEmpty())item {LinearProgressIndicator(Modifier.fillMaxWidth())}
        }
    }
}

@Composable internal fun FollowingPage(data:UiModel) {
    val creators=data.followingTab=="creators"
    val live=data.followingTab=="live"
    val presence=model.presenceInfo
    val info=if(live)FeedInfo(loading=presence.loading,warning=presence.warning)else if(creators)data.followingInfo else data.feedInfo
    Column(Modifier.fillMaxSize()) {
        Box(Modifier.padding(start=12.dp,end=16.dp,top=10.dp,bottom=8.dp)) {ContentHeading("Bilibili Following","feed-refresh",info.loading)}
        Row(Modifier.fillMaxWidth().padding(horizontal=20.dp),horizontalArrangement=Arrangement.spacedBy(4.dp)) {
            listOf("dynamics" to "Following feed","creators" to "Following UP creator","live" to "Live now").forEach {(id,label)->TextButton(onClick={command("following-tab",id)},modifier=Modifier.weight(1f)) {Text(label,fontWeight=if(data.followingTab==id)FontWeight.Bold else FontWeight.Normal,color=if(data.followingTab==id)MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,maxLines=1)}}
        }
        LazyColumn(state=retainedContentScroll(data.viewKey),modifier=Modifier.fillMaxSize(),contentPadding=PaddingValues(start=24.dp,end=24.dp,bottom=190.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
            if(live) {
                item {Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {Text("Following live",Modifier.weight(1f),style=MaterialTheme.typography.titleMedium,fontWeight=FontWeight.SemiBold);TextButton(onClick={command("dialog","live-link")}) {Text("Open another stream")}}}
                item {PresenceStatus(presence)}
                if(presence.loading && model.liveCreators.isEmpty())item {LoadingRows()}
                items(model.liveCreators,key={it.id}) {LiveCreatorRow(it)}
                if(!presence.loading && presence.warning.isEmpty() && presence.fetchedAt>0 && model.liveCreators.isEmpty())item {EmptyState("Followed UP creators are offline","Refresh live status or open another stream.","live")}
            }else if(creators) {
                if(info.total>0)item {Text("Following ${info.total} creators UP creator",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
                if(info.warning.isNotEmpty())item {ErrorCard(info.warning) {command("feed-refresh")}}
                if(info.loading && data.followingCreators.isEmpty())item {LoadingRows()}
                items(data.followingCreators,key={it.id}) {CreatorResultRow(it)}
                if(!info.loading && data.followingCreators.isEmpty() && info.warning.isEmpty())item {EmptyState("No followed UP creator","This list syncs with your connected Bilibili account.","artist")}
                if(info.notice.isNotEmpty())item {Text(info.notice,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
                if(info.next.isNotEmpty())item {TextButton(onClick={command("followings-more")},enabled=!info.loading,modifier=Modifier.fillMaxWidth()) {Text("Load more UP creator")}}
                if(info.loading && data.followingCreators.isNotEmpty())item {LinearProgressIndicator(Modifier.fillMaxWidth())}
            } else activityItems(data)
        }
    }
}
