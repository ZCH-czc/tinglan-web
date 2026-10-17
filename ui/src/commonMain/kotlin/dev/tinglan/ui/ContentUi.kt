package dev.tinglan.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*

// Retain each content page's position across back navigation, with the same bound as UI snapshots.
private val contentScrolls=mutableMapOf<String,LazyListState>()
internal fun retainedContentScroll(key:String):LazyListState {
    val state=contentScrolls.remove(key) ?: LazyListState()
    contentScrolls[key]=state
    while(contentScrolls.size>24)contentScrolls.remove(contentScrolls.keys.first())
    return state
}

@Composable internal fun CreatorResultRow(creator:CreatorResult) {
    Surface(onClick={command("creator-direct",payload("id" to creator.id,"source" to creator.source))},shape=RoundedCornerShape(18.dp),color=Color.Transparent) {
        Row(Modifier.fillMaxWidth().padding(vertical=12.dp,horizontal=8.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(14.dp)) {
            val room=roomForCreator(creator.id,creator.source)
            LiveCreatorAvatar(Song(creator.avatarKey,creator.name,"",cover=creator.avatarKey.isNotEmpty(),source=creator.source),58.dp,room)
            Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(5.dp)) {
                Text(creator.name,maxLines=1,overflow=TextOverflow.Ellipsis,fontWeight=FontWeight.SemiBold)
                if(room.isNotEmpty())Text("Live · Open the avatar to watch",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.primary)
                Text(if(creator.followers>0)"${creator.followers} followers" else platformName(creator.source),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                if(creator.description.isNotBlank())Text(creator.description,maxLines=2,overflow=TextOverflow.Ellipsis,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Glyph("next",Modifier.size(18.dp),MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable internal fun ContentHeading(title:String,refresh:String,loading:Boolean) {
    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
        Action("back","Return to previous page") {command("page-back")}
        Text(title,Modifier.weight(1f).padding(horizontal=8.dp),style=MaterialTheme.typography.titleLarge,fontWeight=FontWeight.SemiBold,maxLines=1,overflow=TextOverflow.Ellipsis)
        Action("refresh","Refresh $title",enabled=!loading) {command(refresh)}
    }
}

@Composable internal fun CommentsPage(data:UiModel) {
    val info=data.commentInfo ?: CommentInfo(loading=true)
    Column(Modifier.fillMaxSize()) {
        Box(Modifier.padding(start=12.dp,end=16.dp,top=10.dp,bottom=8.dp)) {ContentHeading(if(info.root.isEmpty())"Comments" else "Replies","comments-refresh",info.loading)}
        LazyColumn(state=retainedContentScroll(data.viewKey),modifier=Modifier.fillMaxSize(),contentPadding=PaddingValues(start=24.dp,end=24.dp,bottom=190.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
            item {
                info.subject?.let {song->Text(song.title,style=MaterialTheme.typography.titleMedium,fontWeight=FontWeight.SemiBold);Text("${platformName(song.source)} · ${info.total} items ${if(info.root.isEmpty())"Comments" else "Reply"}",Modifier.padding(top=7.dp),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
                if(info.root.isEmpty())Row(Modifier.padding(top=6.dp),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                    listOf("hot" to "Popular","new" to "Latest").forEach {(id,label)->TextButton(onClick={command("comments-order",id)}) {Text(label,fontWeight=if(info.order==id)FontWeight.Bold else FontWeight.Normal,color=if(info.order==id)MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)}}
                }
            }
            if(info.root.isNotEmpty() && info.parent!=null)item(key="parent-${info.parent.id}") {CommentCard(info.parent,false);Text("All replies",Modifier.padding(top=20.dp),fontWeight=FontWeight.SemiBold)}
            if(info.warning.isNotEmpty())item {ErrorCard(info.warning) {command("comments-refresh")}}
            if(info.notice.isNotEmpty())item {Text(info.notice,color=MaterialTheme.colorScheme.onSurfaceVariant,style=MaterialTheme.typography.bodySmall)}
            if(info.loading && data.comments.isEmpty())item {LoadingRows()}
            items(data.comments,key={"comment-${it.id}"}) {CommentCard(it,info.root.isEmpty())}
            if(!info.loading && data.comments.isEmpty() && info.warning.isEmpty() && info.notice.isEmpty())item {EmptyState("No comments yet","Comments reflect the content currently returned by the platform.","comment")}
            if(info.next.isNotEmpty())item {TextButton(onClick={command("comments-more")},enabled=!info.loading,modifier=Modifier.fillMaxWidth()) {Text("Next page")}}
            if(info.loading && data.comments.isNotEmpty())item {LinearProgressIndicator(Modifier.fillMaxWidth())}
        }
    }
}

@Composable private fun CommentCard(comment:Comment,allowReplies:Boolean) {
    Surface(shape=RoundedCornerShape(20.dp),color=MaterialTheme.colorScheme.surfaceContainer.copy(alpha=.7f)) {
        Column(Modifier.fillMaxWidth().padding(16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                val profile=comment.source=="bili" && comment.authorId.isNotEmpty()
                Row(Modifier.weight(1f).clip(RoundedCornerShape(10.dp)).clickable(enabled=profile) {command("creator-direct",payload("source" to comment.source,"id" to comment.authorId))},verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                    Box(Modifier.clip(CircleShape)) {Cover(Song(comment.avatarKey,comment.author,"",cover=comment.avatarKey.isNotEmpty(),source=comment.source),40.dp)}
                    Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)) {
                        Text(comment.author,fontWeight=FontWeight.SemiBold,maxLines=1,overflow=TextOverflow.Ellipsis)
                        if(comment.badges.isNotEmpty())Text(comment.badges.joinToString(" · "),color=MaterialTheme.colorScheme.primary,style=MaterialTheme.typography.labelSmall)
                    }
                }
                if(comment.pinned)Text("Pinned",color=MaterialTheme.colorScheme.primary,style=MaterialTheme.typography.labelMedium)
            }
            CommentText(comment)
            comment.quote?.let {quote->Surface(shape=RoundedCornerShape(12.dp),color=MaterialTheme.colorScheme.onSurface.copy(alpha=.04f)) {Text("${quote.author}: ${quote.text}",Modifier.padding(12.dp),color=MaterialTheme.colorScheme.onSurfaceVariant,style=MaterialTheme.typography.bodySmall)}}
            if(comment.pictures.isNotEmpty())Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)) {comment.pictures.forEach {key->Cover(Song(key,"Comment image","",cover=true,source=comment.source),88.dp)}}
            Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                Text(listOf(comment.atText,comment.location).filter {it.isNotEmpty()}.joinToString(" · "),Modifier.weight(1f),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                Text("likes ${comment.likes}",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if(comment.authorLiked)Text("Liked by author",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.primary)
            if(allowReplies && comment.previews.isNotEmpty())Surface(shape=RoundedCornerShape(14.dp),color=MaterialTheme.colorScheme.onSurface.copy(alpha=.04f)) {
                Column(Modifier.fillMaxWidth().padding(12.dp),verticalArrangement=Arrangement.spacedBy(10.dp)) {
                    comment.previews.forEach {preview->RichContentText("${preview.author}: ${preview.text}",preview.emotes,preview.source,maxLines=2,copyLabel="Copy reply",onClick={command("comments-replies",comment.id)})}
                    Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(6.dp)) {Glyph("comment",Modifier.size(15.dp),MaterialTheme.colorScheme.primary);Text("Open a reply to see the full discussion",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.primary)}
                }
            }
            if(allowReplies && comment.replyCount>0)TextButton(onClick={command("comments-replies",comment.id)},contentPadding=PaddingValues(horizontal=0.dp)) {Glyph("comment",Modifier.size(18.dp),MaterialTheme.colorScheme.primary);Spacer(Modifier.width(8.dp));Text("View ${comment.replyCount} replies")}
        }
    }
}

@Composable private fun CommentText(comment:Comment) {
    RichContentText(comment.text,comment.emotes,comment.source,copyLabel="Copy comment")
}
@Composable internal fun RichContentText(text:String,emotes:List<CommentEmote>,source:String="bili",maxLines:Int=Int.MAX_VALUE,copyLabel:String="Copy post",onClick:(()->Unit)?=null) {
    val rich=remember(text,emotes) {
        val indexed=emotes.filter {it.token.isNotEmpty() && it.key.isNotEmpty()}.associateBy {it.token}
        val pattern=if(indexed.isEmpty())null else Regex(indexed.keys.sortedByDescending {it.length}.joinToString("|") {Regex.escape(it)})
        buildAnnotatedString {var at=0;pattern?.findAll(text)?.forEach {match->append(text.substring(at,match.range.first));appendInlineContent(indexed.getValue(match.value).key,match.value);at=match.range.last+1};append(text.substring(at))}
    }
    val images=remember(emotes,source) {emotes.associate {emote->emote.key to InlineTextContent(Placeholder(24.sp,24.sp,PlaceholderVerticalAlign.TextCenter)) {Cover(Song(emote.key,emote.token,"",cover=true,source=source),24.dp)}}}
    Text(rich,inlineContent=images,maxLines=maxLines,overflow=TextOverflow.Ellipsis,modifier=Modifier.fillMaxWidth().pointerInput(text,onClick) {detectTapGestures(onTap={onClick?.invoke()},onLongPress={command("content-copy",text)})}.semantics {if(onClick!=null)this.onClick(label="Open full discussion or content") {onClick();true};onLongClick(label=copyLabel) {command("content-copy",text);true}},style=MaterialTheme.typography.bodyLarge)
}

@Composable internal fun CollectionPage(data:UiModel) {
    val info=data.collectionInfo ?: CollectionInfo(loading=true)
    var expanded by remember(info.source,info.id) {mutableStateOf(false)}
    val local=data.playlists.any {it.id=="collection-${info.source}-${info.id}"}
    Column(Modifier.fillMaxSize()) {
        Box(Modifier.padding(start=12.dp,end=16.dp,top=10.dp,bottom=8.dp)) {ContentHeading("Platform playlists","collection-refresh",info.loading)}
        LazyColumn(state=retainedContentScroll(data.viewKey),modifier=Modifier.fillMaxSize(),contentPadding=PaddingValues(start=24.dp,end=24.dp,bottom=190.dp),verticalArrangement=Arrangement.spacedBy(10.dp)) {
            item {
                Row(Modifier.padding(vertical=12.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(18.dp)) {
                    Cover(Song(info.coverKey,info.title,"",cover=info.coverKey.isNotEmpty(),source=info.source),92.dp)
                    Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(7.dp)) {Text(info.title.ifEmpty {"Loading playlist…"},style=MaterialTheme.typography.headlineSmall,fontWeight=FontWeight.Bold,maxLines=3,overflow=TextOverflow.Ellipsis);Text(info.owner.ifEmpty {platformName(info.source)},color=MaterialTheme.colorScheme.onSurfaceVariant,style=MaterialTheme.typography.bodySmall);Text("${info.total} tracks",color=MaterialTheme.colorScheme.onSurfaceVariant,style=MaterialTheme.typography.bodySmall)}
                }
                if(info.description.isNotEmpty()) {Text(info.description,maxLines=if(expanded)Int.MAX_VALUE else 3,overflow=TextOverflow.Ellipsis,color=MaterialTheme.colorScheme.onSurfaceVariant);TextButton(onClick={expanded=!expanded}) {Text(if(expanded)"Hide description" else "Show description")}}
                Button(onClick={command("collection-import")},enabled=!data.busy && !info.loading && info.title.isNotEmpty(),shape=RoundedCornerShape(16.dp),modifier=Modifier.padding(vertical=8.dp)) {Glyph("playlist",Modifier.size(18.dp),MaterialTheme.colorScheme.onPrimary);Spacer(Modifier.width(8.dp));Text(if(local)"Open local playlist" else "Save as local playlist")}
                Text("Save the available track list. Download audio separately from each track’s menu.",color=MaterialTheme.colorScheme.onSurfaceVariant,style=MaterialTheme.typography.bodySmall)
            }
            if(info.warning.isNotEmpty())item {ErrorCard(info.warning) {command("collection-refresh")}}
            if(info.unavailable>0)item {Text("On this page, ${info.unavailable} items unavailable",color=MaterialTheme.colorScheme.onSurfaceVariant,style=MaterialTheme.typography.bodySmall)}
            item {Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {Text("Tracks",Modifier.weight(1f),style=MaterialTheme.typography.titleMedium,fontWeight=FontWeight.SemiBold);Action("back","Previous",enabled=info.page>1 && !info.loading) {command("collection-page",(info.page-1).toString())};Text("Page ${info.page} ",style=MaterialTheme.typography.labelMedium);Action("next","Next",enabled=info.more && !info.loading) {command("collection-page",(info.page+1).toString())}}}
            if(info.loading && data.collectionSongs.isEmpty())item {LoadingRows()}
            items(data.collectionSongs,key={it.id}) {SongRow(it,"collection")}
            if(!info.loading && data.collectionSongs.isEmpty() && info.warning.isEmpty())item {EmptyState("No music here yet","This playlist has no available tracks.","playlist")}
        }
    }
}

@Composable internal fun CollectionLinkDialog() {
    var text by remember {mutableStateOf("")}
    var source by remember {mutableStateOf("qq")}
    TinglanAlertDialog(onDismissRequest={command("dialog-close")},shape=RoundedCornerShape(26.dp),title={Text("Open platform playlist")},text={
        Column(verticalArrangement=Arrangement.spacedBy(14.dp)) {
            Row(horizontalArrangement=Arrangement.spacedBy(10.dp)) {listOf("qq","bili","netease").forEach {id->Surface(onClick={source=id},shape=RoundedCornerShape(14.dp),color=if(id==source)MaterialTheme.colorScheme.primary.copy(alpha=.1f)else Color.Transparent,modifier=Modifier.semantics {contentDescription=platformName(id);selected=id==source}) {Box(Modifier.padding(14.dp)) {Glyph(id,color=sourceColor(id))}}}}
            Text("Paste a playlist URL, or choose a platform and enter its playlist ID ID. Bilibili Collections and video series are supported.",style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
            TextField(value=text,onValueChange={text=it.take(2048)},label={Text("Playlist URL / ID")},modifier=Modifier.fillMaxWidth(),shape=RoundedCornerShape(14.dp),maxLines=4)
        }
    },confirmButton={TextButton(onClick={command("collection-open",payload("text" to text,"source" to source))},enabled=text.isNotBlank()) {Text("Open")}},dismissButton={TextButton(onClick={command("dialog-close")}) {Text("Cancel")}})
}
