@file:OptIn(androidx.compose.animation.ExperimentalAnimationApi::class, androidx.compose.material3.ExperimentalMaterial3Api::class)
package dev.tinglan.ui

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.interaction.collectIsDraggedAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.*
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*
import kotlinx.coroutines.launch
import kotlin.time.TimeSource
import kotlinx.serialization.json.*
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import org.jetbrains.compose.resources.Font
import dev.tinglan.ui.generated.resources.Res
import dev.tinglan.ui.generated.resources.noto_sans_sc

private val FastCurve = CubicBezierEasing(.2f, .0f, .0f, 1f)
private val Shape = RoundedCornerShape(20.dp)
internal fun motionDuration(ms:Int)=if(model.reduced)0 else if(model.motionPreset=="slow")(ms*1.5f).toInt()else ms
private fun duration(ms:Int)=motionDuration(ms)
internal fun payload(vararg fields: Pair<String, String>) = buildJsonObject { fields.forEach { put(it.first, it.second) } }.toString()
internal fun platformName(id: String) = when(id) { "qq" -> "QQ Music"; "bili" -> "Bilibili"; "netease" -> "NetEase Music"; else -> "Local music" }
internal fun sourceColor(id: String) = when(id) { "qq" -> Color(0xFF1CB578); "bili" -> Color(0xFFEC7298); "netease" -> Color(0xFFE55055); else -> Color(0xFF247583) }

@Composable fun TinglanApp() {
    val target = if(model.dark) darkColorScheme(primary=Color(0xFF86D4DE), onPrimary=Color(0xFF083D47), background=Color(0xFF11191C), surface=Color(0xFF182225), surfaceContainer=Color(0xFF202D31),surfaceContainerLow=Color(0xFF18272C),surfaceContainerHigh=Color(0xFF26363B),surfaceContainerHighest=Color(0xFF2D3E44),surfaceVariant=Color(0xFF2D3E44),primaryContainer=Color(0xFF184D58),onPrimaryContainer=Color(0xFFB8EFF6),secondary=Color(0xFF95C5CF),secondaryContainer=Color(0xFF29464E),onSecondaryContainer=Color(0xFFC5E8EF),onSurfaceVariant=Color(0xFFBCCBD0))
        else lightColorScheme(primary=Color(0xFF126A7A), onPrimary=Color.White, background=Color(0xFFF5FAFD), surface=Color(0xFFF5FAFD), surfaceContainer=Color(0xFFEBF2F6),surfaceContainerLow=Color(0xFFF0F6F9),surfaceContainerHigh=Color(0xFFE6EFF3),surfaceContainerHighest=Color(0xFFE0EAEE),surfaceVariant=Color(0xFFE0EAEE),primaryContainer=Color(0xFFC4EAF0),onPrimaryContainer=Color(0xFF124650),secondary=Color(0xFF426873),secondaryContainer=Color(0xFFD8E9ED),onSecondaryContainer=Color(0xFF244A54),onSurfaceVariant=Color(0xFF4D6067))
    val bg by animateColorAsState(target.background, tween(duration(220)), label="appearance")
    val type = applicationTypography()
    val homeScroll=rememberLazyListState()
    val searchScroll=rememberLazyListState()
    val settingsScroll=rememberLazyListState()
    val settingsFilter=remember {mutableStateOf(androidx.compose.ui.text.input.TextFieldValue(""))}
    val accountScroll=remember {mutableMapOf<String,LazyListState>()}
    val libraryScroll=remember { mutableMapOf<String,LazyListState>() }
    MaterialTheme(colorScheme=target.copy(background=bg), typography=type) {
        TinglanModalHost("tinglan-root") {
        Surface(Modifier.fillMaxSize(), color=bg) {
            BoxWithConstraints {
                val wide = maxWidth >= 960.dp
                if (!model.ready) {
                    Column(Modifier.align(Alignment.Center), horizontalAlignment=Alignment.CenterHorizontally, verticalArrangement=Arrangement.spacedBy(24.dp)) {
                        Glyph("brand", Modifier.size(52.dp), target.primary)
                        Text("Tinglan", style=MaterialTheme.typography.headlineLarge)
                        if(model.error.isEmpty()) CircularProgressIndicator(Modifier.size(26.dp), strokeWidth=2.dp)
                        Text(model.error.ifEmpty { "Preparing your music…" }, color=target.onSurfaceVariant)
                        if(model.error.isNotEmpty()) Button(onClick={command("reload")}) { Text("Reload") }
                    }
                } else if(model.page=="lan-sender") {
                    Box(Modifier.fillMaxSize(),contentAlignment=Alignment.TopCenter) {LanSenderPage()}
                } else {
                    Row(Modifier.fillMaxSize()) {
                        if(wide) SideNavigation()
                        Box(Modifier.weight(1f).fillMaxHeight()) {
                            Column(Modifier.fillMaxSize()) {
                                if(model.page !in listOf("creator","comments","collection","dynamic","following","live","webdav","transfer","notes","statistics","radio","cache","accounts"))TopActions(wide)
                                if(model.page in listOf("home","search","library"))InstallSuggestion()
                                Box(Modifier.weight(1f).fillMaxWidth()) {
                                    AnimatedContent(model.viewKey, transitionSpec={ (fadeIn(tween(duration(150))) + slideInHorizontally(tween(duration(220), easing=FastCurve)) { it/30 }).togetherWith(fadeOut(tween(duration(100)))) }, label="navigation") { view ->
                                        val content=pageModels[view] ?: model
                                        when(content.page) {
                                            "search" -> SearchPage(searchScroll,content)
                                            "library" -> LibraryPage(libraryScroll,content)
                                            "settings" -> SettingsPage(settingsScroll,content,settingsFilter)
                                            "accounts" -> AccountsPage(content,accountScroll.getOrPut(content.accountSource){LazyListState()})
                                            "creator" -> CreatorPage(content)
                                            "comments" -> CommentsPage(content)
                                            "webdav" -> WebDavPage(content)
                                            "transfer" -> LanTransferPage(content)
                                            "notes" -> NotesPage(content)
                                            "statistics" -> StatisticsPage(content)
                                            "radio" -> RadioPage(content)
                                            "cache" -> CachePage(content)
                                            "collection" -> CollectionPage(content)
                                            "dynamic" -> DynamicPage(content)
                                            "following" -> FollowingPage(content)
                                            "live" -> LivePage(content)
                                            else -> HomePage(homeScroll,content)
                                        }
                                    }
                                }
                            }
                            Column(Modifier.align(Alignment.BottomCenter).widthIn(max=860.dp).fillMaxWidth().padding(horizontal=16.dp, vertical=12.dp), verticalArrangement=Arrangement.spacedBy(8.dp)) {
                                AnimatedVisibility((model.current!=null || model.radio.active) && model.page!="live", enter=fadeIn(tween(duration(150)))+slideInVertically(tween(duration(180))) { it }, exit=fadeOut(tween(duration(120)))) { MiniPlayer() }
                                if(!wide) BottomNavigation()
                            }
                        }
                    }
                    AnimatedVisibility(model.player, enter=slideInVertically(tween(duration(280), easing=FastCurve)) { it }+fadeIn(tween(duration(150))), exit=slideOutVertically(tween(duration(240), easing=FastCurve)) { it }+fadeOut(tween(duration(180)))) { FullPlayer() }
                    if(model.queueOpen) QueuePanel()
                    if(model.cacheInfo.notice!=null)Box(Modifier.align(Alignment.TopCenter).padding(top=8.dp)) {CachePressureBanner()}
                    if(model.dialog.isNotEmpty()) AppDialog()
                    GuideLayer()
                    ImageGalleryPanel()
                    UpdateToast(Modifier.align(Alignment.TopCenter).padding(top=12.dp))
                    AnimatedVisibility(model.toast.isNotEmpty(), modifier=Modifier.align(Alignment.TopCenter).padding(top=18.dp), enter=fadeIn(tween(duration(130)))+slideInVertically { -it/2 }, exit=fadeOut(tween(duration(100)))) {
                        Surface(shape=RoundedCornerShape(16.dp), color=target.inverseSurface, shadowElevation=3.dp, modifier=Modifier.widthIn(max=520.dp).padding(horizontal=16.dp)) {
                            Text(model.toast, color=target.inverseOnSurface, modifier=Modifier.padding(18.dp,12.dp))
                        }
                    }
                    if(model.busy) Surface(Modifier.align(Alignment.TopCenter).widthIn(max=540.dp).fillMaxWidth().padding(14.dp), shape=Shape, color=target.surfaceContainer, shadowElevation=2.dp) {
                        Column(Modifier.padding(16.dp), verticalArrangement=Arrangement.spacedBy(10.dp)) {
                            Row(verticalAlignment=Alignment.CenterVertically) { Text(model.message, Modifier.weight(1f), maxLines=2); if(model.importingCollection)Action("close","Cancel playlist save") {command("collection-cancel")}else if(model.dialog=="backup-progress") Action("close","Cancel task") {command("cancel-backup")} }
                            LinearProgressIndicator(progress={model.progress.coerceIn(0f,1f)}, modifier=Modifier.fillMaxWidth(), strokeCap=StrokeCap.Round)
                        }
                    }
                }
            }
        }
    }
    }
}

private val destinations = listOf(Triple("home","home","Home"),Triple("search","search","Search"),Triple("library","library","Library"))
@Composable private fun SideNavigation() {
    Column(Modifier.width(218.dp).fillMaxHeight().background(MaterialTheme.colorScheme.surfaceContainer.copy(alpha=.5f)).padding(20.dp), verticalArrangement=Arrangement.spacedBy(10.dp)) {
        Row(Modifier.padding(vertical=24.dp), verticalAlignment=Alignment.CenterVertically, horizontalArrangement=Arrangement.spacedBy(12.dp)) { Glyph("brand", Modifier.size(32.dp), MaterialTheme.colorScheme.primary); Text("Tinglan",style=MaterialTheme.typography.headlineMedium, fontWeight=FontWeight.Bold) }
        destinations.forEach { (id,icon,title) ->
            FlatSelectableSurface(selected=model.page==id,onClick={command("navigate",id)},shape=RoundedCornerShape(16.dp),color=Color.Transparent) {
                Row(Modifier.fillMaxWidth().padding(16.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(14.dp)) { Glyph(icon,color=if(model.page==id)MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant); Text(title, fontWeight=if(model.page==id)FontWeight.SemiBold else FontWeight.Normal) }
            }
        }
        Spacer(Modifier.weight(1f))
        Text("Your music, wherever you are", color=MaterialTheme.colorScheme.onSurfaceVariant, style=MaterialTheme.typography.bodySmall)
        Text("Web · 0.31.1",color=MaterialTheme.colorScheme.onSurfaceVariant,style=MaterialTheme.typography.labelSmall)
    }
}
@Composable private fun BottomNavigation() {
    Surface(shape=RoundedCornerShape(32.dp),color=MaterialTheme.colorScheme.surfaceContainer, tonalElevation=0.dp) {
        Row(Modifier.fillMaxWidth().padding(5.dp),horizontalArrangement=Arrangement.SpaceEvenly) {
            destinations.forEach { (id,icon,title) ->
                val selected=model.page==id
                FlatSelectableSurface(selected=selected,shape=RoundedCornerShape(27.dp),color=Color.Transparent,modifier=Modifier.weight(1f),onClick={command("navigate",id)}) {
                Column(Modifier.fillMaxWidth().padding(vertical=10.dp),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(4.dp)) {
                    Glyph(icon,color=if(selected)MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(title,style=MaterialTheme.typography.labelMedium,color=if(selected)MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
                }
                }
            }
        }
    }
}
@Composable private fun TopActions(wide: Boolean) {
    Row(Modifier.fillMaxWidth().height(58.dp).padding(start=20.dp,end=12.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.End) {
        if(model.page=="settings")Text("Settings",Modifier.weight(1f),style=MaterialTheme.typography.titleLarge,fontWeight=FontWeight.Bold)
        Surface(modifier=Modifier.guideTarget("top-actions"),shape=RoundedCornerShape(28.dp),color=MaterialTheme.colorScheme.surfaceContainerLow,
            border=BorderStroke(.5.dp,MaterialTheme.colorScheme.onSurface.copy(alpha=.09f)),shadowElevation=1.dp) {
            Row {
                PrimaryAction("clock","Recently played") {command("navigate","library");command("tab","recent")}
                PrimaryAction("new-release","New releases") {command("search-history-use","New music")}
                PrimaryAction("settings","Settings") {command("navigate","settings")}
            }
        }
    }
}
@Composable private fun PrimaryAction(icon:String,label:String,onClick:()->Unit) {
    val interactions=remember {androidx.compose.foundation.interaction.MutableInteractionSource()}
    val pressed by interactions.collectIsPressedAsState()
    val scale by animateFloatAsState(if(pressed).9f else 1f,tween(motionDuration(if(pressed)90 else 140)),label="action-press")
    IconButton(onClick=onClick,interactionSource=interactions,modifier=Modifier.size(44.dp).semantics {contentDescription=label}) {
        Glyph(icon,Modifier.size(22.dp).graphicsLayer {scaleX=scale;scaleY=scale},MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
@Composable internal fun Action(icon:String,label:String, modifier:Modifier=Modifier, color:Color=MaterialTheme.colorScheme.onSurface, enabled:Boolean=true, onClick:()->Unit) {
    IconButton(onClick=onClick,enabled=enabled,modifier=modifier.size(44.dp).semantics {contentDescription=label}) { Glyph(icon,color=if(enabled)color else color.copy(alpha=.4f)) }
}
@Composable internal fun Cover(song:Song?,size:Dp, large:Boolean=false) {
    val key=(song?.id.orEmpty()) + if(large)":full" else ""
    val revision=artRevision
    val image=artworkFor(key)
    LaunchedEffect(key,song?.cover,image) { if(song?.cover==true && image==null) command("cover",key) }
    val color=sourceColor(song?.source.orEmpty())
    Box(Modifier.size(size).clip(RoundedCornerShape(if(large)22.dp else 12.dp)).background(Brush.linearGradient(listOf(color.copy(alpha=.22f),color.copy(alpha=.5f)))),contentAlignment=Alignment.Center) {
        if(image!=null) Image(image,null,Modifier.fillMaxSize(),contentScale=ContentScale.Crop) else Glyph("music",Modifier.size(size*.42f),color)
    }
}
@Composable internal fun SongRow(song:Song,context:String="",queued:Boolean=false,onSelect:(()->Unit)?=null,selection:Boolean=false) {
    val current=if(queued)song.queueKey.isNotEmpty() && song.queueKey==model.queueCurrentKey else song.id==model.current?.id
    FlatSelectableSurface(selected=if(onSelect!=null)selection else current,onClick={if(onSelect!=null)onSelect()else command("play",payload("id" to song.id,"context" to context,"queueKey" to song.queueKey))},shape=RoundedCornerShape(16.dp),color=MaterialTheme.colorScheme.surfaceContainerLow,modifier=Modifier.fillMaxWidth()) {
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val compact=maxWidth<520.dp
            Row(Modifier.fillMaxWidth().padding(horizontal=10.dp,vertical=9.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                Box(Modifier.clip(RoundedCornerShape(12.dp))) {
                    Cover(song,52.dp)
                    if(current)Box(Modifier.matchParentSize().background(Color.Black.copy(alpha=.35f)),contentAlignment=Alignment.Center){PlayingBars(playing=model.status=="playing",animate=!model.player && !model.queueOpen && model.dialog.isEmpty())}
                }
                Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)) {
                    Text(song.title,maxLines=1,overflow=TextOverflow.Ellipsis,fontWeight=FontWeight.SemiBold,color=if(current)MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)
                    Text((if(queued && song.queueIndex>=0)"${song.queueIndex+1} · "else "")+song.artist+(if(song.duration>0)" · ${timestamp(song.duration)}"else "")+(if(!compact && song.album.isNotEmpty())" · ${song.album}"else ""),maxLines=1,overflow=TextOverflow.Ellipsis,color=MaterialTheme.colorScheme.onSurfaceVariant,style=MaterialTheme.typography.bodySmall)
                }
                if(!compact && !queued && onSelect==null)Action(if(song.favorite)"liked"else "heart","Favorite ${song.title}",color=if(song.favorite)MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant){command("favorite",song.id)}
                if(onSelect==null)Action("more","More actions: ${song.title}"){command("song-menu",payload("id" to song.id,"context" to context,"queueKey" to song.queueKey))}
            }
        }
    }
}
@Composable internal fun EmptyState(title:String,copy:String,icon:String="music",action:String="",onClick:()->Unit={}) {
    Column(Modifier.fillMaxWidth().padding(horizontal=24.dp,vertical=50.dp),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(16.dp)) {
        Box(Modifier.size(76.dp).clip(RoundedCornerShape(24.dp)).background(MaterialTheme.colorScheme.primary.copy(alpha=.08f)),contentAlignment=Alignment.Center) { Glyph(icon,Modifier.size(34.dp),MaterialTheme.colorScheme.primary) }
        Text(title,style=MaterialTheme.typography.titleLarge,fontWeight=FontWeight.SemiBold)
        Text(copy,color=MaterialTheme.colorScheme.onSurfaceVariant,style=MaterialTheme.typography.bodyMedium)
        if(action.isNotEmpty()) Button(onClick=onClick,shape=RoundedCornerShape(16.dp)) {Text(action)}
    }
}
@Composable private fun HomePage(scroll:LazyListState,data:UiModel) {
    val model=data
    LazyColumn(state=scroll,modifier=Modifier.fillMaxSize(),contentPadding=PaddingValues(start=24.dp,end=24.dp,top=12.dp,bottom=190.dp),verticalArrangement=Arrangement.spacedBy(18.dp)) {
        item {
            Surface(shape=RoundedCornerShape(26.dp),color=MaterialTheme.colorScheme.primary.copy(alpha=.09f)) {
                Column(Modifier.fillMaxWidth().padding(28.dp),verticalArrangement=Arrangement.spacedBy(14.dp)) {
                    Text("A little more music",style=MaterialTheme.typography.headlineMedium,fontWeight=FontWeight.Bold)
                    Text(if(model.staticHosting)"Import music and keep your favorites close. Tracks stay in this device’s browser."else "Discover familiar sounds and keep your own music together.",color=MaterialTheme.colorScheme.onSurfaceVariant)
                    Row(horizontalArrangement=Arrangement.spacedBy(10.dp)) { Button(onClick={command("navigate","search")},shape=RoundedCornerShape(14.dp)) {Glyph("search",Modifier.size(18.dp),MaterialTheme.colorScheme.onPrimary);Spacer(Modifier.width(8.dp));Text("Find a song")}; TextButton(onClick={command("import")}) {Text("Import music")} }
                }
            }
        }
        if(model.songs.isNotEmpty()) {
            item {Text("Recently added",style=MaterialTheme.typography.titleLarge,fontWeight=FontWeight.Bold)}
            items(model.songs.take(5),key={"recent-${it.id}"}) {SongRow(it,"home")}
        }
        if(model.staticHosting) item {
            Surface(shape=RoundedCornerShape(22.dp),color=MaterialTheme.colorScheme.surfaceContainerLow) {
                Column(Modifier.fillMaxWidth().padding(22.dp),verticalArrangement=Arrangement.spacedBy(10.dp)) {
                    Text("GitHub Pages · Local music edition",style=MaterialTheme.typography.titleMedium,fontWeight=FontWeight.SemiBold)
                    Text("Local playback, playlists, lyrics, and backups work here. Platform search, sign-in, video, and live streams require the companion running on your computer. Open its local URL to use them.",color=MaterialTheme.colorScheme.onSurfaceVariant)
                    TextButton(onClick={command("navigate","library")}) {Text("Open library")}
                }
            }
        }
        if(!model.staticHosting) {
        item {TextButton(onClick={command("following-open")}) {Glyph("feed",Modifier.size(20.dp),sourceColor("bili"));Spacer(Modifier.width(9.dp));Text("Bilibili Following feed & UP creator")}}
        item {Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {Text("Across your platforms",Modifier.weight(1f),style=MaterialTheme.typography.titleLarge,fontWeight=FontWeight.Bold);Action("refresh","Refresh recommendations") {command("refresh-home")}}}
        model.sections.forEach { section ->
            item(key="heading-${section.id}") {PlatformHeading(section,false)}
            if(section.loading && section.songs.isEmpty()) item {LoadingRows()}
            if(section.error.isNotEmpty()) item {ErrorCard(section.error) {command("refresh-source",section.id)}}
            items(section.songs.take(6),key={"discover-${it.id}"}) {SongRow(it,"section:${section.id}")}
        }
        }
    }
}
@Composable private fun FilterIcons() {
    Row(Modifier.fillMaxWidth().padding(horizontal=16.dp),horizontalArrangement=Arrangement.spacedBy(10.dp),verticalAlignment=Alignment.CenterVertically) {
        (if(model.staticHosting)listOf("local" to "folder")else listOf("all" to "library","qq" to "qq","bili" to "bili","netease" to "netease","local" to "folder")).forEach { (id,icon) ->
            val selected=model.source==id
            Column(Modifier.width(48.dp).clip(RoundedCornerShape(12.dp)).semantics {contentDescription=if(id=="all")"All platforms" else platformName(id);this.selected=selected}.clickable {command("search-source",id)}.padding(vertical=10.dp),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(7.dp)) {
                Glyph(icon,color=if(selected)MaterialTheme.colorScheme.primary else if(id=="all")MaterialTheme.colorScheme.onSurfaceVariant else sourceColor(id))
                Box(Modifier.width(22.dp).height(3.dp).clip(RoundedCornerShape(2.dp)).background(if(selected)MaterialTheme.colorScheme.primary else Color.Transparent))
            }
        }
        Spacer(Modifier.weight(1f));if(!model.staticHosting)Action("settings","Search preferences") {command("dialog","search-preference")}
    }
}
@Composable private fun SearchPage(state:LazyListState,data:UiModel) {
    val model=data
    var text by remember {mutableStateOf(TextFieldValue(model.query))}
    val keyboard=LocalSoftwareKeyboardController.current
    LaunchedEffect(model.query) {if(text.text!=model.query && text.composition==null)text=TextFieldValue(model.query,androidx.compose.ui.text.TextRange(model.query.length))}
    BoxWithConstraints(Modifier.fillMaxSize(),contentAlignment=Alignment.TopCenter) {
    val resultColumns=when {maxWidth>=1240.dp->3;maxWidth>=780.dp->2;else->1}
    Column(Modifier.widthIn(max=1480.dp).fillMaxSize()) {
        Surface(shape=RoundedCornerShape(22.dp),color=MaterialTheme.colorScheme.surfaceContainer,modifier=Modifier.padding(horizontal=24.dp,vertical=12.dp).fillMaxWidth()) {
            Row(Modifier.padding(horizontal=16.dp,vertical=4.dp),verticalAlignment=Alignment.CenterVertically) {
                Glyph("search",color=MaterialTheme.colorScheme.onSurfaceVariant)
                TextField(value=text,onValueChange={text=it;if(it.composition==null)command("search-query",it.text)else command("search-composing")},keyboardOptions=KeyboardOptions(imeAction=ImeAction.Search),keyboardActions=KeyboardActions(onSearch={command("search-submit");keyboard?.hide()}),modifier=Modifier.weight(1f),placeholder={Text(if(model.staticHosting)"Search library tracks or artists"else "Search tracks, videos, or artists")},singleLine=true,colors=TextFieldDefaults.colors(focusedContainerColor=Color.Transparent,unfocusedContainerColor=Color.Transparent,focusedIndicatorColor=Color.Transparent,unfocusedIndicatorColor=Color.Transparent))
                if(text.text.isNotEmpty()) Action("close","Clear search") {text=TextFieldValue("");command("search-query","")}
            }
        }
        FilterIcons()
        Row(Modifier.fillMaxWidth().padding(horizontal=24.dp),horizontalArrangement=Arrangement.spacedBy(12.dp)) {
            (if(model.staticHosting)listOf("songs" to "Local music")else listOf("songs" to "Tracks / Videos","creators" to "UP creator / Artists")).forEach {(id,label)->TextButton(onClick={command("search-kind",id)}) {
                Column(horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(6.dp)) {Text(label,color=if(model.searchKind==id)MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant);Box(Modifier.width(24.dp).height(2.dp).background(if(model.searchKind==id)MaterialTheme.colorScheme.primary else Color.Transparent))}
            }}
        }
        LazyColumn(state=state,contentPadding=PaddingValues(start=24.dp,end=24.dp,top=14.dp,bottom=190.dp),verticalArrangement=Arrangement.spacedBy(6.dp)) {
            if(model.query.isBlank()) {
                if(model.searchHistory.isNotEmpty()) {
                    item {Row(Modifier.fillMaxWidth().padding(top=8.dp),verticalAlignment=Alignment.CenterVertically) {Text("Recent searches",Modifier.weight(1f),style=MaterialTheme.typography.titleMedium,fontWeight=FontWeight.SemiBold);Action("delete","Clear search history"){command("search-history-clear")}}}
                    item {Text("Recent 30 entries · Stored in this browser only",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
                    item {SearchHistoryGrid(model.searchHistory)}
                }else item {EmptyState("Find your next favorite",if(model.staticHosting)"Search imported music by title or artist."else "Search music platforms by title or artist.","search")}
            }
            else {
                if(model.source in listOf("all","local")) {
                    item {Text("Library",style=MaterialTheme.typography.titleMedium,modifier=Modifier.padding(vertical=12.dp),fontWeight=FontWeight.Bold)}
                    items(model.songs.chunked(resultColumns),key={"local-${it.first().id}"}) {row->SearchSongRow(row,resultColumns,"search-local")}
                    if(model.songs.isEmpty()) item {Text("No matching tracks in your library",color=MaterialTheme.colorScheme.onSurfaceVariant,modifier=Modifier.padding(vertical=12.dp))}
                }
                model.sections.forEach { section ->
                    item(key="search-heading-${section.id}") {PlatformHeading(section,true)}
                    if(section.loading && section.songs.isEmpty() && section.creators.isEmpty()) item {LoadingRows()}
                    if(section.error.isNotEmpty()) item {ErrorCard(section.error) {command("search-retry",section.id)}}
                    items(section.songs.chunked(resultColumns),key={"result-${section.id}-${it.first().id}"}) {row->SearchSongRow(row,resultColumns,"section:${section.id}")}
                    items(section.creators.chunked(resultColumns),key={"creator-${section.id}-${it.first().id}"}) {row->Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(12.dp)){row.forEach{creator->Box(Modifier.weight(1f)){CreatorResultRow(creator)}};repeat(resultColumns-row.size){Spacer(Modifier.weight(1f))}}}
                    if(section.more) item {TextButton(onClick={command("search-more",section.id)}) {Text("Load more ${section.title} results")}}
                }
            }
        }
    }
}
}
@Composable private fun SearchSongRow(songs:List<Song>,columns:Int,context:String) {
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(12.dp)){songs.forEach{song->Box(Modifier.weight(1f)){SongRow(song,context)}};repeat(columns-songs.size){Spacer(Modifier.weight(1f))}}
}
@Composable private fun PlatformHeading(section:PlatformSection,collapse:Boolean) {
    Row(Modifier.fillMaxWidth().padding(top=14.dp,bottom=8.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(10.dp)) {
        Glyph(section.id,color=sourceColor(section.id));Text(section.title,Modifier.weight(1f),fontWeight=FontWeight.Bold)
        if(section.loading) CircularProgressIndicator(Modifier.size(18.dp),strokeWidth=2.dp)
        if(collapse) Action(if(section.collapsed)"add" else "down","${if(section.collapsed)"Expand" else "Collapse"} ${section.title}") {command("collapse",section.id)}
    }
}
@Composable internal fun LoadingRows() {
    Column(verticalArrangement=Arrangement.spacedBy(12.dp),modifier=Modifier.padding(vertical=8.dp)) {
        repeat(3) {Row(Modifier.fillMaxWidth().height(54.dp),horizontalArrangement=Arrangement.spacedBy(14.dp),verticalAlignment=Alignment.CenterVertically) {
            Box(Modifier.size(48.dp).clip(RoundedCornerShape(12.dp)).background(MaterialTheme.colorScheme.surfaceContainer));Column(verticalArrangement=Arrangement.spacedBy(10.dp)) {Box(Modifier.width(160.dp).height(12.dp).clip(Shape).background(MaterialTheme.colorScheme.surfaceContainer));Box(Modifier.width(96.dp).height(10.dp).clip(Shape).background(MaterialTheme.colorScheme.surfaceContainer))}
        }}
    }
}
@Composable internal fun ErrorCard(message:String,retry:()->Unit) {
    Surface(shape=Shape,color=MaterialTheme.colorScheme.surfaceContainer) {
        Row(Modifier.fillMaxWidth().padding(16.dp),verticalAlignment=Alignment.CenterVertically) {Text(message,Modifier.weight(1f),style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant);TextButton(onClick=retry) {Text("Retry")}}
    }
}
@Composable private fun MiniPlayer() {
    if(model.radio.active){RadioMiniPlayer();return}
    val song=model.current ?: return
    Surface(onClick={command("player-open")},shape=RoundedCornerShape(24.dp),color=MaterialTheme.colorScheme.surfaceContainer,shadowElevation=1.dp) {
        Column {
            Row(Modifier.fillMaxWidth().padding(10.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                Cover(song,50.dp)
                Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(3.dp)) {Text(song.title,maxLines=1,overflow=TextOverflow.Ellipsis,fontWeight=FontWeight.SemiBold);Text(model.playbackHint.ifEmpty {song.artist},maxLines=1,overflow=TextOverflow.Ellipsis,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
                Action(if(song.favorite)"liked" else "heart","Favorite current track") {command("favorite",song.id)}
                PlayControl(false)
                model.cacheTasks.firstOrNull {it.active()}?.let {task->IconButton(onClick={command("cache-open")},modifier=Modifier.size(44.dp)) {CacheDownloadRing(task)}}
                Action("queue","Open queue") {command("queue-open")}
            }
            PlaybackProgress(false)
        }
    }
}
@Composable private fun PlayControl(large:Boolean,compact:Boolean=false) {
    val loading=model.status=="buffering"
    val waiting=model.status=="waiting-network"
    IconButton(onClick={command("toggle")},modifier=Modifier.size(if(compact)56.dp else if(large)76.dp else 44.dp).semantics {contentDescription=if(waiting)"Stop waiting for connection" else if(loading)"Buffering. Tap to pause" else if(model.status=="playing")"Pause" else "Play"}) {
        if(loading) CircularProgressIndicator(Modifier.size(if(large)44.dp else 24.dp),strokeWidth=2.5.dp)
        else Glyph(if(model.status=="playing" || waiting)"pause" else "play",Modifier.size(if(compact)32.dp else if(large)44.dp else 24.dp),MaterialTheme.colorScheme.primary)
    }
}
@Composable private fun FullPlayer() {
    if(model.radio.active){RadioFullPlayer();return}
    val song=model.current ?: return
    var showLyrics by remember {mutableStateOf(false)}
    Surface(Modifier.fillMaxSize(),color=MaterialTheme.colorScheme.background) {
        BoxWithConstraints {
            val landscape=maxWidth>maxHeight && maxWidth>760.dp
            val compactLandscape=landscape && maxHeight<560.dp
            val artworkSize=minOf(maxWidth-70.dp,maxHeight*.45f,380.dp)
            Column(Modifier.fillMaxSize().padding(horizontal=if(landscape)48.dp else 24.dp,vertical=14.dp)) {
                Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {Action("down","Minimize fullscreen player") {command("player-close")};Column(Modifier.weight(1f),horizontalAlignment=Alignment.CenterHorizontally) {Text("Now playing",style=MaterialTheme.typography.labelLarge);if(song.source=="bili")TextButton(onClick={command("bili-context-open")},contentPadding=PaddingValues(horizontal=8.dp,vertical=0.dp)) {Text(model.biliInfo?.collectionTitle?.ifEmpty {"Bilibili · Episodes"} ?: "Bilibili · Episodes",style=MaterialTheme.typography.labelSmall,maxLines=1,overflow=TextOverflow.Ellipsis)}else Text(platformName(song.source),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)};Action("settings","Sound & playback device") {command("audio-open")};if(landscape)Action("queue","Open queue"){command("queue-open")};Action("more","Current track actions") {command("song-menu",payload("id" to song.id))}}
                if(compactLandscape) Row(Modifier.weight(1f).fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(32.dp),verticalAlignment=Alignment.CenterVertically) {
                    BoxWithConstraints(Modifier.weight(1f).fillMaxHeight(),contentAlignment=Alignment.Center) {if(showLyrics)Lyrics(Modifier.fillMaxSize())else PlayerArtwork(song,minOf(maxWidth,maxHeight,300.dp))}
                    Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                        SongTitle(song,compact=true);PlaybackProgress(true);PlayerControls(song,compact=true)
                        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween,verticalAlignment=Alignment.CenterVertically) {
                            Action(if(showLyrics)"artwork"else "lyrics",if(showLyrics)"Show artwork"else "Show lyrics") {showLyrics=!showLyrics}
                            LyricsSourceButton(song)
                        }
                    }
                }else if(landscape) Row(Modifier.weight(1f).fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(56.dp),verticalAlignment=Alignment.CenterVertically) {
                    Column(Modifier.weight(1f),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(12.dp)) {PlayerArtwork(song,300.dp);SongTitle(song);PlaybackProgress(true);PlayerControls(song)}
                    Column(Modifier.weight(1f).fillMaxHeight()) {
                        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {Text("Lyrics",Modifier.weight(1f),style=MaterialTheme.typography.titleMedium);LyricsSourceButton(song)}
                        Lyrics(Modifier.weight(1f).fillMaxWidth())
                    }
                } else {
                    BoxWithConstraints(Modifier.weight(1f).fillMaxWidth(),contentAlignment=Alignment.Center) {if(showLyrics) Lyrics(Modifier.fillMaxSize()) else PlayerArtwork(song,minOf(artworkSize,maxHeight,maxWidth))}
                    Column(Modifier.widthIn(max=560.dp).fillMaxWidth().align(Alignment.CenterHorizontally).padding(bottom=18.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {SongTitle(song);PlaybackProgress(true);PlayerControls(song);Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween) {Action(if(showLyrics)"artwork"else "lyrics",if(showLyrics)"Show artwork"else "Show lyrics") {showLyrics=!showLyrics};LyricsSourceButton(song);Action("queue","Open queue") {command("queue-open")}}}
                }
                if(model.playbackHint.isNotEmpty())Text(model.playbackHint,modifier=Modifier.fillMaxWidth().padding(horizontal=8.dp,vertical=6.dp).semantics {liveRegion=LiveRegionMode.Polite},style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant,maxLines=2,overflow=TextOverflow.Ellipsis)
                if(model.error.isNotEmpty()) ErrorCard(model.error) {command("retry-play")}
            }
        }
    }
}
@Composable private fun PlayerArtwork(song:Song,size:Dp) {
    val density=LocalDensity.current.density
    AnimatedContent(song,contentKey={it.id},transitionSpec={ (slideInHorizontally(tween(duration(220),easing=FastCurve)) {it/5}+fadeIn(tween(duration(180)))).togetherWith(slideOutHorizontally(tween(duration(180))) {-it/5}+fadeOut(tween(duration(140)))) },label="song") {item ->
        Box(Modifier.size(size).onGloballyPositioned {coordinates ->
            val r=coordinates.boundsInWindow()
            if(item.source=="bili")command("artwork-origin",payload("id" to item.id,"x" to (r.left/density).toString(),"y" to (r.top/density).toString(),"width" to (r.width/density).toString(),"height" to (r.height/density).toString()))
        }.pointerInput(item.id,item.source) {if(item.source=="bili")detectTapGestures(onLongPress={command("video-open")})}.semantics {if(item.source=="bili"){contentDescription="Hold the artwork to watch the video";onLongClick {command("video-open");true}}}) {Cover(item,size,true)}
    }
}
@Composable private fun SongTitle(song:Song,compact:Boolean=false) {
    Column(Modifier.fillMaxWidth().padding(horizontal=4.dp),verticalArrangement=Arrangement.spacedBy(if(compact)2.dp else 7.dp)) {Text(song.title,style=if(compact)MaterialTheme.typography.titleLarge else MaterialTheme.typography.headlineSmall,fontWeight=FontWeight.Bold,maxLines=if(compact)1 else 2,overflow=TextOverflow.Ellipsis);Text(song.artist,style=if(compact)MaterialTheme.typography.bodySmall else MaterialTheme.typography.bodyLarge,color=MaterialTheme.colorScheme.onSurfaceVariant,maxLines=1,overflow=TextOverflow.Ellipsis,modifier=Modifier.clip(RoundedCornerShape(8.dp)).clickable(enabled=song.creatorId.isNotEmpty()) {command("creator-open",song.id)}.padding(vertical=5.dp))}
}
@Composable private fun CreatorPage(data:UiModel) {
    val creator=data.creator ?: return
    val state=retainedContentScroll(data.viewKey)
    var expanded by remember(creator.id,creator.source) {mutableStateOf(false)}
    LazyColumn(state=state,modifier=Modifier.fillMaxSize(),contentPadding=PaddingValues(start=24.dp,end=24.dp,top=8.dp,bottom=180.dp),verticalArrangement=Arrangement.spacedBy(14.dp)) {
        item {
            Row(verticalAlignment=Alignment.CenterVertically) {Action("back","Return to previous page") {command("page-back")};Text(platformName(creator.source),Modifier.weight(1f),color=MaterialTheme.colorScheme.onSurfaceVariant);Action("refresh","Refresh artist page",enabled=!creator.loading) {command("creator-refresh")}}
            Row(Modifier.padding(vertical=18.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(18.dp)) {
                val room=roomForCreator(creator.id,creator.source)
                LiveCreatorAvatar(Song("creator-${creator.source}-${creator.id}",creator.name,"",cover=creator.cover,source=creator.source),92.dp,room)
                Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                    Text(creator.name.ifEmpty {"Loading profile…"},style=MaterialTheme.typography.headlineSmall,fontWeight=FontWeight.Bold)
                    if(room.isNotEmpty())Text("Live · Open the avatar to watch",style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.primary)
                    if(creator.followers>0)Text("${creator.followers} followers",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            if(creator.description.isNotEmpty()) {Text(creator.description,maxLines=if(expanded)Int.MAX_VALUE else 4,overflow=TextOverflow.Ellipsis,color=MaterialTheme.colorScheme.onSurfaceVariant);TextButton(onClick={expanded=!expanded}) {Text(if(expanded)"Hide description" else "Show description")}}
        }
        if(creator.loading)item {LinearProgressIndicator(Modifier.fillMaxWidth())}
        if(creator.warning.isNotEmpty())item {ErrorCard(creator.warning) {command("creator-refresh")}}
        if(creator.source=="bili")item {PresenceStatus(model.presenceInfo,author=true)}
        if(creator.source=="bili")item {Row(horizontalArrangement=Arrangement.spacedBy(16.dp)) {listOf("dynamics" to "Posts","works" to "Uploads").forEach {(id,label)->TextButton(onClick={command("creator-tab",id)}) {Text(label,fontWeight=if(data.creatorTab==id)FontWeight.Bold else FontWeight.Normal,color=if(data.creatorTab==id)MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)}}}}
        if(creator.source=="bili" && data.creatorTab=="dynamics")activityItems(data)
        else {
            item {Row(verticalAlignment=Alignment.CenterVertically) {Text(if(creator.source=="bili")"Latest uploads" else "Releases",Modifier.weight(1f),style=MaterialTheme.typography.titleMedium,fontWeight=FontWeight.SemiBold);Action("back","Previous",enabled=creator.page>1 && !creator.loading) {command("creator-page",(creator.page-1).toString())};Text("Page ${creator.page} ",style=MaterialTheme.typography.labelMedium);Action("next","Next",enabled=creator.more && !creator.loading) {command("creator-page",(creator.page+1).toString())}}}
            if(data.creatorSongs.isEmpty() && !creator.loading && creator.warning.isEmpty())item {EmptyState("No releases found","This artist has no available releases.","music")}
            items(data.creatorSongs,key={it.id}) {SongRow(it,"creator:${creator.source}:${creator.id}")}
        }
    }
}
@Composable private fun PlayerControls(song:Song,compact:Boolean=false) {
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceEvenly,verticalAlignment=Alignment.CenterVertically) {
        PlaybackOrderButton()
        Action("previous","Previous track",Modifier.size(50.dp)) {command("previous")}
        PlayControl(true,compact)
        Action("next","Next track",Modifier.size(50.dp)) {command("next")}
        Action(if(song.favorite)"liked" else "heart","Favorite current track") {command("favorite",song.id)}
    }
}
@Composable private fun Lyrics(modifier:Modifier) {
    val state=rememberLazyListState()
    val dragging by state.interactionSource.collectIsDraggedAsState()
    var manualAt by remember(model.current?.id) { mutableStateOf<TimeSource.Monotonic.ValueTimeMark?>(null) }
    LaunchedEffect(dragging) { if(dragging) manualAt=TimeSource.Monotonic.markNow() }
    val index=lyricIndex
    LaunchedEffect(index,model.current?.id) {if(index>=0 && !state.isScrollInProgress && (manualAt?.elapsedNow()?.inWholeMilliseconds ?: 3000)>=3000) {val at=index.coerceAtMost((model.lyrics.size-1).coerceAtLeast(0));if(model.reduced)state.scrollToItem(at,-120)else state.animateScrollToItem(at,-120)}}
    if(model.lyrics.isEmpty()) Box(modifier,contentAlignment=Alignment.Center) {Column(horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(12.dp)) {Text("Let the melody speak",style=MaterialTheme.typography.titleLarge);Text("Import, edit, or choose synchronized lyrics",color=MaterialTheme.colorScheme.onSurfaceVariant);TextButton(onClick={command("lyrics-edit")}) {Text("Add lyrics")}}}
    else LazyColumn(state=state,modifier=modifier,contentPadding=PaddingValues(vertical=120.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
        itemsIndexed(model.lyrics,key={i,_ -> i}) {i,line ->
            val active=i==index
            val alpha by animateFloatAsState(if(active)1f else .4f,tween(duration(180)))
            Text(line.text.ifBlank {"♪"},color=MaterialTheme.colorScheme.onSurface.copy(alpha=alpha),style=MaterialTheme.typography.headlineSmall.copy(fontSize=model.lyricsSize.sp,lineHeight=(model.lyricsSize*1.5f).sp),fontWeight=if(active)FontWeight.Bold else FontWeight.Medium,modifier=Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).pointerInput(line.at,line.text) {detectTapGestures(onTap={command("seek",line.at.toString())},onLongPress={command("copy",line.text)})}.padding(12.dp).semantics {contentDescription="Lyrics ${line.text}";onClick {command("seek",line.at.toString());true};onLongClick {command("copy",line.text);true}})
        }
    }
}
@Composable internal fun SettingCard(title:String,copy:String="",trailing:@Composable ()->Unit) {
    Surface(shape=Shape,color=MaterialTheme.colorScheme.surfaceContainer,modifier=Modifier.fillMaxWidth()) {
        Row(Modifier.padding(20.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(14.dp)) {Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(6.dp)) {Text(title,fontWeight=FontWeight.SemiBold);if(copy.isNotEmpty())Text(copy,color=MaterialTheme.colorScheme.onSurfaceVariant,style=MaterialTheme.typography.bodySmall)};trailing()}
    }
}
@Composable private fun AppDialog() {
    val kind=model.dialog
    if(kind=="search-history-clear"){TinglanAlertDialog(onDismissRequest={command("dialog-close")},title={Text("Clear search history?")},text={Text("Remove recent searches from this browser.")},confirmButton={TextButton(onClick={command("search-history-clear-confirm")}){Text("Clear")}},dismissButton={TextButton(onClick={command("dialog-close")}){Text("Cancel")}});return}
    if(kind in listOf("theme","search-preference")){BasicChoiceSheet();return}
    if(kind in listOf("library-options","library-order","playlist-edit","playlist-delete")){LibraryDialog();return}
    if(kind in listOf("font","motion-preset","lyrics-appearance","guides")){AppearanceDialog();return}
    if(kind=="local-index" || kind=="local-index-clear") {LocalIndexDialog();return}
    if(kind=="recognition" || kind=="recognition-clear") {RecognitionDialog();return}
    if(kind=="audio-settings" || kind=="audio-devices") {AudioDialog();return}
    if(kind=="web-integration"){WebIntegrationDialog();return}
    if(kind=="cache-budget" || kind=="cache-clean") {CacheDialog();return}
    if(kind=="account-connect" || kind=="accounts-help" || kind=="account-disconnect" || kind=="settings-local") {AccountUtilityDialog();return}
    if(kind=="account-qr") {AccountQrDialog();return}
    if(kind=="collection-link") {CollectionLinkDialog();return}
    if(kind=="live-link") {LiveLinkDialog();return}
    if(kind=="bili-context") {if(!model.video.visible)BilibiliContextDialog();return}
    if(kind=="bili-actions") {if(!model.video.visible)BilibiliActionsDialog();return}
    if(kind=="danmaku-settings") {DanmakuSettings {command("dialog-close")};return}
    if(kind=="note-editor" || kind=="note-delete") {NoteDialog();return}
    if(kind=="radio-custom" || kind=="radio-queue") {RadioDialog();return}
    if(kind=="statistics-reset") {TinglanAlertDialog(onDismissRequest={command("dialog-close")},shape=RoundedCornerShape(26.dp),title={Text("Clear listening statistics?")},text={Text("This cannot be undone directly, but exported backups can restore the data. Music, playlists, and notes are kept. New listening will be recorded again.")},confirmButton={TextButton(onClick={command("statistics-reset-confirm")}) {Text("Clear statistics",color=MaterialTheme.colorScheme.error)}},dismissButton={TextButton(onClick={command("dialog-close")}) {Text("Cancel")}});return}
    if(kind=="backup-progress")return
    if(kind=="live-quality"){LiveQualityDialog {command("dialog-close")};return}
    if(kind=="playback-order"){PlaybackOrderDialog();return}
    if(kind=="lyric-source"){LyricsSourceDialog();return}
    var text by remember(kind,model.target) {mutableStateOf(model.dialogText)}
    val menuId=model.target;val menuKey=model.targetQueueKey
    val song=model.queue.find {it.id==model.target} ?: model.songs.find {it.id==model.target} ?: model.current?.takeIf {it.id==model.target} ?: model.sections.flatMap {it.songs}.find {it.id==model.target} ?: model.creatorSongs.find {it.id==model.target} ?: model.collectionSongs.find {it.id==model.target}
    if(kind=="song-menu"){SongActionsSheet(song,menuId,menuKey);return}
    val title=when(kind){"theme"->"Appearance";"song-menu"->song?.title ?: "Track actions";"metadata"->"Edit track details";"lyrics-edit"->"Edit synchronized lyrics";"playlist-create","playlist-create-add"->"Create playlist";"playlist-rename"->"Rename playlist";"playlist-add"->"Add to playlist";"playlist-menu"->"Playlist management";"remove"->"Remove track";"backup-confirm"->"Restore backup";"search-preference"->"Search preferences";"about"->"About Tinglan";else->"Lyrics source"}
    TinglanAlertDialog(onDismissRequest={command("dialog-close")},shape=RoundedCornerShape(26.dp),title={Text(title,maxLines=2,overflow=TextOverflow.Ellipsis)},text={
        Column(Modifier.widthIn(max=480.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(10.dp)) {
            when(kind) {
                "theme" -> listOf("system" to "Follow system","light" to "Light","dark" to "Dark").forEach { (id,label) -> DialogOption(label,"album") {command("setting",payload("key" to "theme","value" to id));command("dialog-close")} }
                "search-preference" -> listOf("qq","bili","netease").forEach {id -> DialogOption("${platformName(id)} first",id) {command("setting",payload("key" to "searchPreference","value" to id));command("dialog-close")}}
                "playlist-menu" -> {DialogOption("Edit name, description, and background","playlist") {command("playlist-edit",model.target)};DialogOption("Delete playlist","delete") {command("playlist-delete-open")}}
                "playlist-add" -> {DialogOption("Create playlist and add","add") {command("playlist-create-add-open")};model.playlists.forEach {p ->DialogOption(p.name,"playlist") {command("playlist-add",p.id)}}}
                "playlist-create","playlist-create-add","playlist-rename" -> TextField(text,{text=it},singleLine=true,label={Text("Playlist name")},modifier=Modifier.fillMaxWidth(),shape=RoundedCornerShape(14.dp))
                "metadata" -> {Text("Enter title, artist, and album in that order, one per line.",color=MaterialTheme.colorScheme.onSurfaceVariant);TextField(text,{text=it},modifier=Modifier.fillMaxWidth().heightIn(min=140.dp),shape=RoundedCornerShape(14.dp))}
                "lyrics-edit" -> {Text("Use LRC timestamps. Your edits are saved locally.",color=MaterialTheme.colorScheme.onSurfaceVariant);TextField(text,{text=it},modifier=Modifier.fillMaxWidth().heightIn(min=180.dp,max=340.dp),shape=RoundedCornerShape(14.dp));Row {TextButton(onClick={command("copy",text)}) {Text("Copy")};TextButton(onClick={command("lyrics-export",text)}) {Text("Export LRC")};TextButton(onClick={command("lyrics-import")}) {Text("Import LRC")}}}
                "remove" -> Text("Remove this track from the browser library. The original file on your device is kept.")
                "backup-confirm" -> Text(model.backupText)


                "about" -> {Text("Tinglan brings your platforms and local music together.\n\nWeb 0.31.1\n The interface is rendered by Compose / Skia .\n\nGPL-3.0\n Includes Kotlin, Compose Multiplatform, Skia, Noto Sans SC and music-metadata. Complete licenses are distributed with the app.");TextButton(onClick={command("licenses")}) {Text("Open-source licenses")}}
                else -> {DialogOption("Platform lyrics / Subtitles","music") {command("lyrics-source","platform")};DialogOption("Kugou lyrics","music") {command("lyrics-source","kugou")};DialogOption("Edited local lyrics","queue") {command("lyrics-edit")}}
            }
        }
    },confirmButton={
        when(kind) {
            "playlist-create","playlist-create-add","playlist-rename","metadata","lyrics-edit" -> TextButton(onClick={command("dialog-save",text)},enabled=text.isNotBlank() && !model.busy && !model.accountChanging) {Text("Save")}
            "remove" -> TextButton(onClick={command("remove",model.target)}) {Text("Remove")}
            "backup-confirm" -> TextButton(onClick={command("backup-restore")}) {Text("Confirm restore")}
            else -> TextButton(onClick={command("dialog-close")}) {Text("Done")}
        }
    },dismissButton={TextButton(onClick={command("dialog-close")}) {Text("Cancel")}})
}
@Composable private fun DialogOption(label:String,icon:String,click:()->Unit) {
    Surface(onClick=click,shape=RoundedCornerShape(14.dp),color=Color.Transparent) {Row(Modifier.fillMaxWidth().heightIn(min=52.dp).padding(12.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(14.dp)) {Glyph(icon,color=if(icon in listOf("qq","bili","netease"))sourceColor(icon)else MaterialTheme.colorScheme.primary);Text(label)}}
}
