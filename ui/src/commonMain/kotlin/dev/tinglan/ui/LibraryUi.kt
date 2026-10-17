@file:OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
package dev.tinglan.ui

import androidx.compose.animation.core.tween
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.pager.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

internal val libraryTabs get()=listOf("overview" to tr("Library"),"playlists" to tr("Playlists"),"platform" to tr("Platform playlists"),"activity" to tr("Following feed"),"songs" to tr("Tracks"),"artists" to tr("Artists"),"albums" to tr("Albums"),"notes" to tr("Music notes"))
@Immutable data class LibraryGroup(val name:String,val count:Int,val cover:Song?)
@Immutable data class LibraryInfo(val stamp:String="",val group:String="",val query:String="",val page:Int=0,val pages:Int=1,val total:Int=0,val duration:Long=0,val order:List<String> = libraryTabs.map {it.first},val view:String="list",val source:String="all",val tag:String="",val sort:String="recent",val descending:Boolean=false,val groups:List<LibraryGroup> = emptyList(),val recent:List<Song> = emptyList(),val playlistIds:List<String> = emptyList(),val tags:List<String> = emptyList(),val counts:Map<String,Int> = emptyMap())
internal fun readLibrary(value:JsonElement?):LibraryInfo {
    val o=value as? JsonObject ?: return LibraryInfo()
    fun s(k:String,d:String="")=o[k]?.jsonPrimitive?.contentOrNull ?: d
    fun n(k:String)=o[k]?.jsonPrimitive?.longOrNull ?: 0L
    fun a(k:String)=(o[k] as? JsonArray)?.map {it.jsonPrimitive.content} ?: emptyList()
    return LibraryInfo(s("stamp"),s("group"),s("query"),n("page").toInt(),n("pages").toInt().coerceAtLeast(1),n("total").toInt(),n("duration"),a("order").ifEmpty {libraryTabs.map {it.first}},s("view","list"),s("source","all"),s("tag"),s("sort","recent"),o["descending"]?.jsonPrimitive?.booleanOrNull==true,
        (o["groups"] as? JsonArray)?.map {it.jsonObject.let {g->LibraryGroup(g["name"]!!.jsonPrimitive.content,g["count"]!!.jsonPrimitive.int,(g["cover"] as? JsonObject)?.let(::song))}} ?: emptyList(),
        (o["recent"] as? JsonArray)?.map(::song) ?: emptyList(),a("playlistIds"),a("tags"),(o["counts"] as? JsonObject)?.mapValues {it.value.jsonPrimitive.int} ?: emptyMap())
}
private fun librarySetting(key:String,value:String)=command("library-setting",payload("key" to key,"value" to value))
private val libraryShape=RoundedCornerShape(18.dp)

@Composable internal fun LibraryPage(scrolls:MutableMap<String,LazyListState>,data:UiModel) {
    val info=data.libraryInfo
    val order=info.order
    val caches=remember {mutableMapOf<String,UiModel>()}
    caches[data.tab]=data
    val index=order.indexOf(data.tab)
    val detail=data.playlistId.isNotEmpty() || info.group.isNotEmpty() || index<0
    if(detail){LibraryBody(retainedLibraryScroll(scrolls,data),data);return}
    val pager=rememberPagerState(initialPage=index.coerceAtLeast(0),pageCount={order.size})
    val scope=rememberCoroutineScope()
    val tabsScroll=rememberScrollState()
    val density=androidx.compose.ui.platform.LocalDensity.current
    LaunchedEffect(order) {pager.scrollToPage(order.indexOf(data.tab).coerceAtLeast(0))}
    LaunchedEffect(data.tab) {if(order.getOrNull(pager.settledPage)!=data.tab && !pager.isScrollInProgress)pager.scrollToPage(index.coerceAtLeast(0))}
    LaunchedEffect(pager,order) {
        snapshotFlow {pager.settledPage to pager.isScrollInProgress}.distinctUntilChanged().collect {(p,moving)->
            if(!moving && order.getOrNull(p)!=model.tab)order.getOrNull(p)?.let {command("tab",it)}
            if(!moving)tabsScroll.animateScrollTo(with(density){((p-1).coerceAtLeast(0)*96).dp.roundToPx()})
        }
    }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(start=16.dp,end=8.dp).guideTarget("library-tabs"),verticalAlignment=Alignment.CenterVertically) {
            Box(Modifier.weight(1f).horizontalScroll(tabsScroll)) {
                Row {order.forEachIndexed {i,id->TextButton(onClick={scope.launch {pager.animateScrollToPage(i,animationSpec=tween(motionDuration(220)))}},modifier=Modifier.width(96.dp).height(48.dp).semantics {selected=pager.currentPage==i}) {Text(libraryTabs.first {it.first==id}.second,color=if(pager.currentPage==i)MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,maxLines=1)}}}
                Box(Modifier.align(Alignment.BottomStart).offset(x=(pager.currentPage+pager.currentPageOffsetFraction).times(96).dp+24.dp).size(48.dp,3.dp).background(MaterialTheme.colorScheme.primary,RoundedCornerShape(2.dp)))
            }
            Action("more",tr("Customize library tab order")) {command("dialog","library-order")}
        }
        HorizontalPager(pager,Modifier.weight(1f),beyondViewportPageCount=0,key={order[it]}) {p->
            val id=order[p];val snapshot=if(data.tab==id)data else caches[id]
            if(snapshot!=null)LibraryBody(retainedLibraryScroll(scrolls,snapshot),snapshot)
            else Box(Modifier.fillMaxSize().padding(24.dp)){LoadingRows()}
        }
    }
}

private fun retainedLibraryScroll(cache:MutableMap<String,LazyListState>,data:UiModel):LazyListState {
    val i=data.libraryInfo
    val key=listOf(data.tab,data.playlistId,i.group,i.query,i.page.toString(),i.source,i.sort,i.descending.toString(),i.tag).joinToString("|")
    val state=cache.remove(key) ?: LazyListState()
    cache[key]=state
    while(cache.size>32)cache.remove(cache.keys.first())
    return state
}

@Composable private fun LibraryBody(scroll:LazyListState,data:UiModel) {
    val info=data.libraryInfo
    val playlist=data.playlists.find {it.id==data.playlistId}
    val grouped=data.tab in listOf("artists","albums") && info.group.isEmpty()
    val playlistList=data.tab=="playlists" && playlist==null
    val songList=playlist!=null || (!grouped && data.tab in listOf("songs","favorites","cached","local","recent","artists","albums"))
    var query by remember(data.tab,data.playlistId,info.group){mutableStateOf(info.query)}
    var selecting by remember(data.tab,data.playlistId,info.group){mutableStateOf(false)}
    var selection by remember(info.stamp){mutableStateOf(setOf<String>())}
    var dragId by remember {mutableStateOf("")};var dragTo by remember {mutableStateOf("")};var dragY by remember {mutableStateOf(0f)}
    val canReorder=playlist!=null && info.sort=="custom" && !info.descending && info.query.isBlank() && info.source=="all" && !selecting
    fun bulk(kind:String){command("library-bulk",payload("kind" to kind,"ids" to selection.joinToString("\n"),"stamp" to info.stamp));selection=emptySet();selecting=false}
    Column(Modifier.fillMaxSize()) {
        if(songList || grouped || playlistList)Row(Modifier.fillMaxWidth().padding(horizontal=24.dp,vertical=10.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(6.dp)) {
            if(playlist!=null || info.group.isNotEmpty() || data.tab !in info.order)Action("back",tr("Back to library")) {command("library-back")}
            TextField(query,{query=it.take(200);command("library-query",query)},singleLine=true,placeholder={Text(tr("Search {0}", if(playlist!=null)tr("this playlist")else tr("Library")))},leadingIcon={Glyph("search")},trailingIcon={if(query.isNotEmpty())Action("close",tr("Clear search")) {query="";command("library-query","")}},shape=RoundedCornerShape(22.dp),colors=TextFieldDefaults.colors(focusedIndicatorColor=Color.Transparent,unfocusedIndicatorColor=Color.Transparent,focusedContainerColor=MaterialTheme.colorScheme.surfaceContainer,unfocusedContainerColor=MaterialTheme.colorScheme.surfaceContainerLow),modifier=Modifier.weight(1f).semantics {contentDescription=tr("Search library")})
            Action("sliders",tr("Filter, sort, and layout")) {command("dialog","library-options")}
            if(songList)Action(if(selecting)"close"else "check",if(selecting)tr("Exit selection")else tr("Select tracks")) {selecting=!selecting;selection=emptySet()}
            if(playlistList)Action("add",tr("Create playlist")) {command("dialog","playlist-create")}
        }
        if(selecting)Surface(color=MaterialTheme.colorScheme.secondaryContainer,modifier=Modifier.fillMaxWidth().padding(horizontal=24.dp),shape=libraryShape) {
            Column(Modifier.padding(8.dp)) {
                Row(verticalAlignment=Alignment.CenterVertically) {TextButton(onClick={selection=if(selection.size==data.songs.size)emptySet()else data.songs.map {it.id}.toSet()}) {Text(tr("Select this page"))};Text(tr("Selected {0}",quantityLabel(selection.size,"track")),style=MaterialTheme.typography.labelLarge)}
                Row(Modifier.horizontalScroll(rememberScrollState())) {listOf("queue" to tr("Add to queue"),"playlist" to tr("Add to playlist"),"favorite" to tr("Favorite"),"download" to tr("Download")).plus(if(playlist!=null)listOf("remove" to tr("Remove from playlist"))else emptyList()).forEach {(key,label)->TextButton(onClick={bulk(key)},enabled=selection.isNotEmpty()){Text(label)}}}
            }
        }
        LazyColumn(state=scroll,modifier=Modifier.fillMaxWidth().weight(1f),contentPadding=PaddingValues(start=24.dp,end=24.dp,top=10.dp,bottom=190.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
            if(data.tab=="overview" && playlist==null) {
                item {Text(tr("Your music"),style=MaterialTheme.typography.headlineSmall,fontWeight=FontWeight.Bold,modifier=Modifier.padding(vertical=10.dp))}
                val shortcuts=listOf(Triple("favorites","heart",tr("Favorites")),Triple("cached","download",tr("Cached")),Triple("local","folder",tr("Local files")),Triple("recent","history",tr("Recently played")))
                items(shortcuts.chunked(2)) {row->Row(horizontalArrangement=Arrangement.spacedBy(12.dp)) {row.forEach {(id,icon,label)->Surface(onClick={command("tab",id)},shape=libraryShape,color=MaterialTheme.colorScheme.surfaceContainer,modifier=Modifier.weight(1f)){Row(Modifier.heightIn(min=88.dp).padding(16.dp),horizontalArrangement=Arrangement.spacedBy(12.dp),verticalAlignment=Alignment.CenterVertically){Glyph(icon,color=MaterialTheme.colorScheme.primary);Column {Text(label,fontWeight=FontWeight.SemiBold);Text(info.counts[id]?.let {"${quantityLabel(it,"track")}"} ?: tr("Keep listening"),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}}}}}}
                item {SettingLink(tr("Music notes"),tr("{0} notes · Categories and search", data.noteCount),"note"){command("notes-open")}}
                item {SettingLink(tr("Listening report"),tr("Daily, weekly, monthly, and all time"),"chart"){command("statistics-open")}}
                item {Row {TextButton(onClick={command("import")}){Text(tr("Import music"))};TextButton(onClick={command("import-folder")}){Text(tr("Import folder"))}}}
                if(info.recent.isNotEmpty()) {item {Text(tr("Recently played"),style=MaterialTheme.typography.titleMedium,fontWeight=FontWeight.Bold,modifier=Modifier.padding(top=12.dp))};items(info.recent,key={"recent-"+it.id}) {SongRow(it,"library-view")}}
            } else if(data.tab in listOf("platform","activity","notes") && playlist==null) {
                item {when(data.tab){"platform"->EmptyState(tr("Platform playlists"),tr("Import QQ Music, Bilibili or NetEase playlists. Video collections can also be saved locally."),"playlist",tr("Open playlist link")){command("collection-link")};"activity"->EmptyState(tr("Voices you follow"),tr("View followed UP creators, posts, comments, and live status."),"feed",tr("Open following feed")){command("following-open")};else->EmptyState(tr("Music notes"),tr("Capture what a song inspires. Organize and search notes by category."),"note",tr("Open music notes")){command("notes-open")}}}
            } else {
                if(playlist!=null)item {PlaylistHeader(playlist,info)}
                else item {Row(verticalAlignment=Alignment.CenterVertically){Column(Modifier.weight(1f)){Text(info.group.ifEmpty {when(data.tab){"favorites"->tr("Favorites");"cached"->tr("Cached music");"recent"->tr("Recently played");"local"->tr("Local music");else->libraryTabs.firstOrNull {it.first==data.tab}?.second ?: tr("Library")}},style=MaterialTheme.typography.titleLarge,fontWeight=FontWeight.Bold);Text("${quantityLabel(info.total,if(grouped || playlistList)"item"else "track")}"+(if(info.source!="all")" · ${platformName(info.source)}"else ""),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)};if(songList)Action("play",tr("Play this list"),enabled=info.total>0){command("library-play")}}}
                if(playlistList){
                    if(info.tags.isNotEmpty())item {Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){(listOf("")+info.tags).forEach {tag->FilterChip(selected=info.tag==tag,onClick={librarySetting("libraryTag",tag)},label={Text(tag.ifEmpty {tr("All tags")})})}}}
                    val rows=data.playlists.filter {it.id in info.playlistIds}
                    items(rows,key={it.id}){p->FlatSelectableSurface(false,libraryShape,MaterialTheme.colorScheme.surfaceContainerLow,onClick={command("playlist-open",p.id)}) {Row(Modifier.fillMaxWidth().padding(12.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(14.dp)){Cover(Song(p.coverId.ifEmpty {"playlist:"+p.id},p.name,"",cover=p.coverId.isNotEmpty()),56.dp);Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)){Text(p.name,fontWeight=FontWeight.SemiBold,maxLines=1,overflow=TextOverflow.Ellipsis);Text("${quantityLabel(p.ids.size,"track")}"+(if(p.tags.isNotEmpty())" · "+p.tags.joinToString(" / ")else ""),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)};Action("more",tr("Manage {0}", p.name)){command("playlist-menu",p.id)}}}}
                } else if(grouped) {
                    items(info.groups.chunked(if(info.view=="grid")2 else 1),key={it.first().name}) {groups->Row(horizontalArrangement=Arrangement.spacedBy(12.dp)){groups.forEach {g->FlatSelectableSurface(false,libraryShape,MaterialTheme.colorScheme.surfaceContainerLow,Modifier.weight(1f),onClick={command("library-group",g.name)}){LibraryGroupContents(g,info.view=="grid",data.tab=="artists")}};if(groups.size==1 && info.view=="grid")Spacer(Modifier.weight(1f))}}
                } else {
                    items(data.songs,key={it.id}) {s->
                        Row(Modifier.fillMaxWidth().zIndex(if(dragId==s.id)1f else 0f).graphicsLayer {if(dragId==s.id){translationY=dragY;alpha=.8f}}.background(if(dragTo==s.id && dragId!=s.id)MaterialTheme.colorScheme.primaryContainer else Color.Transparent,libraryShape),verticalAlignment=Alignment.CenterVertically) {
                            if(selecting)Checkbox(s.id in selection,{selection=if(it)selection+s.id else selection-s.id},modifier=Modifier.semantics {contentDescription=tr("Select {0}", s.title)})
                            Box(Modifier.weight(1f)){SongRow(s,if(playlist!=null)"playlist:${playlist.id}"else "library-view",onSelect=if(selecting)({selection=if(s.id in selection)selection-s.id else selection+s.id})else null,selection=s.id in selection)}
                            if(canReorder)IconButton(onClick={},modifier=Modifier.size(44.dp).pointerInput(s.id){detectDragGesturesAfterLongPress(onDragStart={dragId=s.id;dragTo=s.id;dragY=0f},onDrag={change,delta->change.consume();dragY+=delta.y;scroll.layoutInfo.visibleItemsInfo.firstOrNull {it.key==s.id}?.let {origin->val center=origin.offset+origin.size/2+dragY;scroll.layoutInfo.visibleItemsInfo.filter {item->data.songs.any {it.id==item.key}}.minByOrNull {kotlin.math.abs(it.offset+it.size/2-center)}?.let {dragTo=it.key as String}}},onDragEnd={if(dragTo!=dragId)command("playlist-sort-move",payload("id" to playlist!!.id,"songId" to s.id,"destinationId" to dragTo));dragId="";dragTo="";dragY=0f},onDragCancel={dragId="";dragTo="";dragY=0f})}.semantics {contentDescription=tr("Hold to reorder: {0}", s.title);customActions=listOf(CustomAccessibilityAction(tr("Move forward")){val at=data.songs.indexOf(s);if(at>0)command("playlist-sort-move",payload("id" to playlist!!.id,"songId" to s.id,"destinationId" to data.songs[at-1].id));true},CustomAccessibilityAction(tr("Move backward")){val at=data.songs.indexOf(s);if(at<data.songs.lastIndex)command("playlist-sort-move",payload("id" to playlist!!.id,"songId" to s.id,"destinationId" to data.songs[at+1].id));true})}){Glyph("drag")}
                        }
                    }
                }
                if(info.total==0)item {EmptyState(tr("Nothing here yet"),if(info.query.isNotEmpty() || info.source!="all" || info.tag.isNotEmpty())tr("Try clearing the search or filters.")else tr("Import music or save tracks from search results."),"music")}
                if(info.pages>1)item {Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.Center,verticalAlignment=Alignment.CenterVertically){Action("back",tr("Previous library page"),enabled=info.page>0){command("library-page",(info.page-1).toString())};Text("${info.page+1} / ${info.pages}",Modifier.padding(horizontal=20.dp));Action("next",tr("Next library page"),enabled=info.page+1<info.pages){command("library-page",(info.page+1).toString())}}}
            }
        }
    }
}

@Composable private fun PlaylistHeader(p:Playlist,info:LibraryInfo) {
    Surface(shape=RoundedCornerShape(22.dp),color=MaterialTheme.colorScheme.surfaceContainerLow) {
        Box(Modifier.fillMaxWidth()) {
            if(p.background!="none")Box(Modifier.matchParentSize().graphicsLayer {alpha=p.backgroundOpacity}) {LibraryArtwork(if(p.background=="custom")"playlist:"+p.id else p.backgroundTrackId,Modifier.fillMaxSize())}
            Column(Modifier.fillMaxWidth().padding(20.dp),verticalArrangement=Arrangement.spacedBy(10.dp)) {
                Row(verticalAlignment=Alignment.CenterVertically){Text(p.name,Modifier.weight(1f),style=MaterialTheme.typography.headlineSmall,fontWeight=FontWeight.Bold);Action("more",tr("Manage playlist")){command("playlist-menu",p.id)}}
                if(p.description.isNotBlank())Text(p.description,style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
                Text("${quantityLabel(p.ids.size,"track")} · ${timestamp(info.duration)}",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                if(p.tags.isNotEmpty())Text(p.tags.joinToString("  ·  "),style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.primary)
                Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){Button(onClick={command("library-play")},enabled=info.total>0){Glyph("play",Modifier.size(18.dp));Text(tr("Play all"),Modifier.padding(start=6.dp))};TextButton(onClick={command("library-play","shuffle")},enabled=info.total>0){Text(tr("Shuffle"))}}
            }
        }
    }
}

@Composable internal fun LibraryDialog() {
    val kind=model.dialog;val info=model.libraryInfo;val p=model.playlists.find {it.id==model.target}
    var name by remember(model.target){mutableStateOf(p?.name ?: "")};var description by remember(model.target){mutableStateOf(p?.description ?: "")};var tags by remember(model.target){mutableStateOf(p?.tags?.joinToString(", ") ?: "")}
    var background by remember(model.target,p?.background){mutableStateOf(p?.background ?: "none")};var backgroundId by remember(model.target){mutableStateOf(p?.backgroundTrackId ?: "")};var opacity by remember(model.target){mutableStateOf(p?.backgroundOpacity ?: .12f)}
    var order by remember {mutableStateOf(info.order)}
    TinglanAlertDialog(onDismissRequest={command("dialog-close")},title={Text(when(kind){"playlist-edit"->tr("Edit playlist");"playlist-delete"->tr("Delete playlist?");"library-order"->tr("Library tab order");else->tr("Library display")})},text={Column(Modifier.widthIn(max=480.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(10.dp)) {
        when(kind) {
            "playlist-edit"->{
                if(p==null)Text(tr("Playlist no longer exists"))else {
                    OutlinedTextField(name,{name=it.take(80)},label={Text(tr("Playlist name"))},singleLine=true,modifier=Modifier.fillMaxWidth())
                    OutlinedTextField(description,{description=it.take(1000)},label={Text(tr("Description"))},minLines=2,maxLines=4,modifier=Modifier.fillMaxWidth())
                    OutlinedTextField(tags,{tags=it.take(660)},label={Text(tr("Tags, separated by commas"))},modifier=Modifier.fillMaxWidth())
                    Text(tr("Playlist background"),fontWeight=FontWeight.SemiBold)
                    Row {FilterChip(background=="none",{background="none"},label={Text(tr("None"))});Spacer(Modifier.width(8.dp));FilterChip(background=="song",{background="song";if(backgroundId.isEmpty())backgroundId=p.ids.firstOrNull() ?: ""},label={Text(tr("Track artwork"))})}
                    TextButton(onClick={command("playlist-background-file",p.id)}){Text(if(p.background=="custom")tr("Replace custom background")else tr("Choose custom image"))}
                    if(p.background=="custom")FilterChip(background=="custom",{background="custom"},label={Text(tr("Use selected image"))})
                    if(background=="song") {Text(tr("Choose artwork track"),style=MaterialTheme.typography.labelMedium);val choices=model.songs.filter {it.id in p.ids};choices.take(20).forEach {s->SelectionRow(s.title,backgroundId==s.id){backgroundId=s.id}};if(choices.size>20)Text(tr("Showing the first 20 tracks"),style=MaterialTheme.typography.bodySmall)}
                    if(background!="none"){Text(tr("Background opacity {0}%", (opacity*100).toInt()),style=MaterialTheme.typography.labelMedium);Slider(opacity,{opacity=it},valueRange=.04f.. .35f)}
                }
            }
            "playlist-delete"->Text(tr("Delete“{0}”and its custom background. Tracks, favorites, and music notes are kept.", p?.name ?: tr("this playlist")))
            "library-order"->{Text(tr("Use the arrows to reorder. The current page and saved content are unchanged."),style=MaterialTheme.typography.bodySmall);order.forEachIndexed {i,id->Row(verticalAlignment=Alignment.CenterVertically){Text(libraryTabs.first {it.first==id}.second,Modifier.weight(1f));Action("up",tr("Move up {0}", libraryTabs.first {it.first==id}.second),enabled=i>0){order=order.toMutableList().apply {add(i-1,removeAt(i))}};Action("down",tr("Move down {0}", libraryTabs.first {it.first==id}.second),enabled=i<order.lastIndex){order=order.toMutableList().apply {add(i+1,removeAt(i))}}}}}
            else->{
                Text(tr("Music source"),fontWeight=FontWeight.SemiBold);Row(Modifier.horizontalScroll(rememberScrollState())){listOf("all","qq","bili","netease","local").forEach {id->TextButton(onClick={librarySetting("librarySource",id)}){Text((if(info.source==id)"✓ "else "")+if(id=="all")tr("All")else platformName(id))}}}
                Text(tr("Sort"),fontWeight=FontWeight.SemiBold);listOf("custom" to tr("Custom order"),"recent" to tr("Recently added"),"title" to tr("Track title"),"artist" to tr("Artists"),"album" to tr("Albums"),"duration" to tr("Duration")).forEach {(key,label)->SelectionRow(label,info.sort==key){librarySetting("sort",key)}}
                Row(verticalAlignment=Alignment.CenterVertically){Text(tr("Descending"),Modifier.weight(1f));Switch(info.descending,{librarySetting("sortDescending",it.toString())})}
                Row(verticalAlignment=Alignment.CenterVertically){Text(tr("Album and artist grid"),Modifier.weight(1f));Switch(info.view=="grid",{librarySetting("libraryView",if(it)"grid"else "list")})}
                if(model.playlistId.isNotEmpty())Text(tr("In custom order, clear search and source filters, then hold the handle to reorder."),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if(model.dialogError.isNotBlank())Text(trMessage(model.dialogError),color=MaterialTheme.colorScheme.error)
    }},confirmButton={TextButton(enabled=kind!="playlist-edit" || (p!=null && name.isNotBlank()),onClick={when(kind){"playlist-edit"->command("playlist-save",payload("id" to p!!.id,"name" to name,"description" to description,"tags" to tags,"background" to background,"backgroundTrackId" to backgroundId,"backgroundOpacity" to opacity.toString()));"playlist-delete"->command("playlist-delete",model.target);"library-order"->{librarySetting("libraryOrder",order.joinToString(","));command("dialog-close")};else->command("dialog-close")}}){Text(if(kind=="playlist-delete")tr("Delete")else if(kind in listOf("playlist-edit","library-order"))tr("Save")else tr("Done"))}},dismissButton={TextButton(onClick={command("dialog-close")}){Text(tr("Cancel"))}})
}

@Composable private fun LibraryArtwork(id:String,modifier:Modifier) {
    val revision=artRevision
    val key=id+":full";val image=artworkFor(key)
    LaunchedEffect(key,image){if(image==null)command("cover",key)}
    if(image!=null)Image(image,null,modifier,contentScale=androidx.compose.ui.layout.ContentScale.Crop)
}

@Composable private fun LibraryGroupContents(group:LibraryGroup,grid:Boolean,artist:Boolean) {
    @Composable fun art(){Box(Modifier.clip(if(artist)androidx.compose.foundation.shape.CircleShape else RoundedCornerShape(12.dp))){group.cover?.let {Cover(it,if(grid)88.dp else 56.dp)}}}
    @Composable fun label(){Text(group.name,fontWeight=FontWeight.SemiBold,maxLines=if(grid)2 else 1,overflow=TextOverflow.Ellipsis);Text("${quantityLabel(group.count,"track")}",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
    if(grid)Column(Modifier.fillMaxWidth().padding(14.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){art();label()}
    else Row(Modifier.fillMaxWidth().padding(12.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(14.dp)){art();Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)){label()};Glyph("chevron",Modifier.size(18.dp),MaterialTheme.colorScheme.onSurfaceVariant)}
}
