@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
package dev.tinglan.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

@Composable internal fun NotesPage(data:UiModel) {
    val info=data.notesInfo
    Column(Modifier.fillMaxSize()) {
        Box(Modifier.padding(start=12.dp,end=16.dp,top=10.dp,bottom=8.dp)) {ContentHeading(tr("Music notes"),"notes-refresh",info.loading)}
        TextField(info.query,{command("notes-query",it.take(128))},placeholder={Text(tr("Search tracks, artists, or notes"))},singleLine=true,leadingIcon={Glyph("search")},trailingIcon={if(info.query.isNotEmpty())Action("close",tr("Clear note search")) {command("notes-query","")}},modifier=Modifier.fillMaxWidth().padding(horizontal=24.dp),shape=RoundedCornerShape(18.dp),colors=TextFieldDefaults.colors(focusedIndicatorColor=androidx.compose.ui.graphics.Color.Transparent,unfocusedIndicatorColor=androidx.compose.ui.graphics.Color.Transparent))
        LazyRow(contentPadding=PaddingValues(horizontal=24.dp,vertical=10.dp),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
            item {FilterChip(info.category.isEmpty(),{command("notes-category","")},label={Text(tr("All"))})}
            items(data.noteCategories,key={it}) {category->FilterChip(info.category==category,{command("notes-category",category)},label={Text(category)})}
            if(info.category.isNotEmpty() && info.category !in data.noteCategories)item {FilterChip(true,{command("notes-category","")},label={Text(info.category)},trailingIcon={Glyph("close",Modifier.size(14.dp))})}
        }
        LazyColumn(state=retainedContentScroll(data.viewKey+"|query="+info.query),modifier=Modifier.fillMaxSize(),contentPadding=PaddingValues(start=24.dp,end=24.dp,bottom=190.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
            item {Text(tr("{0} notes · Stored in this browser", info.count),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
            if(info.warning.isNotEmpty())item {ErrorCard(info.warning) {command("notes-refresh")}}
            if(info.loading && data.noteItems.isEmpty())item {LoadingRows()}
            items(data.noteItems,key={it.songId}) {note->
                Surface(onClick={command("note-open",note.songId)},shape=RoundedCornerShape(20.dp),color=MaterialTheme.colorScheme.surfaceContainer) {
                    Column(Modifier.fillMaxWidth().padding(16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
                        Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {Cover(Song(note.songId,note.title,note.artists,cover=note.hasArtwork,source=note.source),48.dp);Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)) {Text(note.title.ifEmpty {tr("Untitled track")},fontWeight=FontWeight.SemiBold,maxLines=1,overflow=TextOverflow.Ellipsis);Text(note.artists,maxLines=1,overflow=TextOverflow.Ellipsis,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)};Glyph("note",Modifier.size(20.dp),MaterialTheme.colorScheme.primary)}
                        Text(note.preview,maxLines=6,overflow=TextOverflow.Ellipsis,style=MaterialTheme.typography.bodyMedium)
                        Text("${note.category} · ${note.dateLabel}",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.primary)
                    }
                }
            }
            if(!info.loading && data.noteItems.isEmpty() && info.warning.isEmpty())item {EmptyState(if(info.query.isNotEmpty() || info.category.isNotEmpty())tr("No matching notes") else tr("Capture what the music brings"),tr("Choose Music notes from a track menu to start writing."),"note")}
            if(info.loading && data.noteItems.isNotEmpty())item {LinearProgressIndicator(Modifier.fillMaxWidth())}
            if(info.count>0)item {Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.Center) {Action("back",tr("Previous notes page"),enabled=info.page>0 && !info.loading) {command("notes-page",(info.page-1).toString())};Text("${info.page+1} / ${info.pages}",Modifier.padding(horizontal=18.dp),style=MaterialTheme.typography.labelMedium);Action("next",tr("Next notes page"),enabled=info.page+1<info.pages && !info.loading) {command("notes-page",(info.page+1).toString())}}}
        }
    }
}

@Composable internal fun NoteDialog() {
    val info=model.noteEditor
    var content by remember(info.token) {mutableStateOf(info.content)}
    var category by remember(info.token) {mutableStateOf(info.category)}
    LaunchedEffect(info.token,info.loaded) {if(info.loaded){content=info.content;category=info.category}}
    if(model.dialog=="note-delete") {
        TinglanAlertDialog(onDismissRequest={if(!info.busy)command("note-editor-return",info.token)},shape=RoundedCornerShape(26.dp),title={Text(tr("Delete this note?"))},text={Column(verticalArrangement=Arrangement.spacedBy(12.dp)) {Text(info.title);Text(tr("This note will be removed from this browser. Exported backups can still restore it. The track and queue are kept."),color=MaterialTheme.colorScheme.onSurfaceVariant);if(info.error.isNotEmpty())Text(trMessage(info.error),color=MaterialTheme.colorScheme.error)}},confirmButton={TextButton(onClick={command("note-delete-confirm",info.token)},enabled=!info.busy && !info.conflict) {Text(if(info.busy)tr("Deleting…") else tr("Delete note"))}},dismissButton={TextButton(onClick={command("note-editor-return",info.token)},enabled=!info.busy) {Text(tr("Back to editing"))}})
        return
    }
    TinglanAlertDialog(onDismissRequest={if(!info.busy)command("dialog-close")},shape=RoundedCornerShape(26.dp),title={Text(tr("Music notes"))},text={
        Column(Modifier.widthIn(max=480.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(12.dp)) {
            Text(info.title,style=MaterialTheme.typography.titleMedium,maxLines=2,overflow=TextOverflow.Ellipsis)
            Text(info.artists,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            if(info.loading)LinearProgressIndicator(Modifier.fillMaxWidth())
            TextField(category,{category=it.take(32)},label={Text(tr("Category"))},singleLine=true,enabled=info.loaded && !info.busy,shape=RoundedCornerShape(14.dp),modifier=Modifier.fillMaxWidth())
            TextField(content,{content=it.take(12000)},label={Text(tr("Write what this song makes you feel"))},minLines=4,maxLines=9,enabled=info.loaded && !info.busy,shape=RoundedCornerShape(14.dp),modifier=Modifier.fillMaxWidth())
            Text(tr("{0} / 12000 · Saved locally only", content.length),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            if(info.error.isNotEmpty()) {Text(trMessage(info.error),color=MaterialTheme.colorScheme.error);TextButton(onClick={command("note-reload",payload("token" to info.token))},enabled=!info.busy) {Text(if(info.conflict)tr("Reload and replace unsaved changes") else tr("Reload note"))}}
            if(info.loaded)Row {TextButton(onClick={command("copy",content)},enabled=content.isNotEmpty()) {Text(tr("Copy note"))};if(info.exists)TextButton(onClick={command("note-delete",info.token)},enabled=!info.busy) {Text(tr("Delete"))}}
        }
    },confirmButton={TextButton(onClick={command("note-save",payload("token" to info.token,"content" to content,"category" to category))},enabled=info.loaded && content.isNotBlank() && !info.busy && !info.conflict) {Text(if(info.busy)tr("Saving…") else tr("Save locally"))}},dismissButton={TextButton(onClick={command("dialog-close")},enabled=!info.busy) {Text(tr("Cancel"))}})
}
