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

@Immutable data class RadioStationUi(val id:String,val name:String,val description:String,val coverKey:String="",val favorite:Boolean=false,val category:String="",val custom:Boolean=false)
@Immutable data class RadioPageInfo(val scope:String="domestic",val query:String="",val loading:Boolean=false,val loadingMore:Boolean=false,val more:Boolean=false,val error:String="",val loadingRadioId:String="")
@Immutable data class RadioPlaybackInfo(val active:Boolean=false,val status:String="idle",val station:RadioStationUi?=null,val error:String="")

@Composable internal fun RadioPage(data:UiModel) {
    val info=data.radioPage
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(start=12.dp,end=24.dp,top=10.dp,bottom=8.dp),verticalAlignment=Alignment.CenterVertically) {Box(Modifier.weight(1f)){ContentHeading(tr("Radio"),"radio-refresh",info.loading)};Action("add",tr("Add custom station")) {command("dialog","radio-custom")}}
        TextField(info.query,{command("radio-query",it.take(120))},singleLine=true,placeholder={Text(if(info.scope=="qq")tr("Search QQ Radio themes") else tr("Search stations"))},leadingIcon={Glyph("search")},trailingIcon={if(info.query.isNotEmpty())Action("close",tr("Clear station search")) {command("radio-query","")}},modifier=Modifier.fillMaxWidth().padding(horizontal=24.dp),shape=RoundedCornerShape(18.dp),colors=TextFieldDefaults.colors(focusedIndicatorColor=androidx.compose.ui.graphics.Color.Transparent,unfocusedIndicatorColor=androidx.compose.ui.graphics.Color.Transparent))
        LazyRow(contentPadding=PaddingValues(horizontal=24.dp,vertical=10.dp),horizontalArrangement=Arrangement.spacedBy(8.dp)) {items(listOf("domestic" to tr("China"),"world" to tr("Worldwide"),"favorites" to tr("Favorites"),"recent" to tr("Recent"),"qq" to tr("QQ Music"))) {(key,label)->FilterChip(info.scope==key,{command("radio-scope",key)},label={Text(label)})}}
        LazyColumn(state=retainedContentScroll(data.viewKey),modifier=Modifier.fillMaxSize(),contentPadding=PaddingValues(start=24.dp,end=24.dp,bottom=190.dp),verticalArrangement=Arrangement.spacedBy(10.dp)) {
            if(info.error.isNotEmpty())item {ErrorCard(info.error){command("radio-refresh")}}
            if(info.loading && data.radioItems.isEmpty())item {LoadingRows()}
            items(data.radioItems,key={it.id}) {station->
                val loading=info.loadingRadioId==station.id
                Surface(onClick={if(info.scope=="qq")command("radio-qq-play",station.id)else command("radio-play",station.id)},shape=RoundedCornerShape(18.dp),color=MaterialTheme.colorScheme.surfaceContainer) {Row(Modifier.fillMaxWidth().padding(12.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(14.dp)) {RadioCover(station,52);Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(5.dp)) {Text(station.name,maxLines=1,overflow=TextOverflow.Ellipsis,fontWeight=FontWeight.SemiBold);Text(station.description.ifBlank {station.category.ifBlank {tr("FM Internet radio")}},maxLines=2,overflow=TextOverflow.Ellipsis,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)};if(info.scope!="qq")Action(if(station.favorite)"liked" else "heart",tr("Favorites {0}", station.name)) {command("radio-favorite",station.id)};if(loading)CircularProgressIndicator(Modifier.size(22.dp),strokeWidth=2.dp)else Glyph(if(data.radio.active && data.radio.station?.id==station.id && data.radio.status=="playing")"pause" else "play",Modifier.size(24.dp),MaterialTheme.colorScheme.primary)}}
            }
            if(info.loading && data.radioItems.isNotEmpty())item {LinearProgressIndicator(Modifier.fillMaxWidth())}
            if(!info.loading && data.radioItems.isEmpty() && info.error.isEmpty())item {EmptyState(if(info.scope=="favorites")tr("Save your favorite stations") else tr("No matching stations"),if(info.scope=="favorites")tr("Tap the heart next to a station, or add a custom HTTPS station.") else tr("Try another keyword or refresh later."),"music")}
            if(info.more)item {TextButton(onClick={command("radio-more")},enabled=!info.loadingMore) {if(info.loadingMore)CircularProgressIndicator(Modifier.size(18.dp),strokeWidth=2.dp);Text(if(info.loadingMore)tr("Loading…") else tr("More stations"),Modifier.padding(start=8.dp))}}
        }
    }
}
@Composable private fun RadioCover(station:RadioStationUi,size:Int) {Cover(Song(station.coverKey.ifEmpty {"radio-art-${station.id}"},station.name,"FM",cover=station.coverKey.isNotEmpty()),size.dp)}
@Composable internal fun RadioMiniPlayer() {
    val info=model.radio;val station=info.station ?: return
    Surface(onClick={command("player-open")},shape=RoundedCornerShape(24.dp),color=MaterialTheme.colorScheme.surfaceContainer,shadowElevation=1.dp) {Row(Modifier.fillMaxWidth().padding(10.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {RadioCover(station,50);Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)) {Text(station.name,maxLines=1,overflow=TextOverflow.Ellipsis,fontWeight=FontWeight.SemiBold);Text(if(info.status in listOf("loading","buffering"))tr("Connecting to station…") else tr("FM Live · {0}", station.description),maxLines=1,overflow=TextOverflow.Ellipsis,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)};Action(if(station.favorite)"liked" else "heart",tr("Favorite this station")) {command("radio-favorite",station.id)};RadioPlayControl();Action("queue",tr("Switch station")) {command("dialog","radio-queue")}}}
}
@Composable private fun RadioPlayControl() {IconButton(onClick={command("radio-toggle")}) {if(model.radio.status in listOf("loading","buffering"))CircularProgressIndicator(Modifier.size(24.dp),strokeWidth=2.dp)else Glyph(if(model.radio.status=="playing")"pause" else "play",Modifier.size(26.dp))}}
@Composable internal fun RadioFullPlayer() {
    val info=model.radio;val station=info.station ?: return
    Surface(Modifier.fillMaxSize(),color=MaterialTheme.colorScheme.background) {Column(Modifier.fillMaxSize().padding(horizontal=24.dp,vertical=16.dp),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(18.dp)) {Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {Action("down",tr("Minimize player")) {command("player-close")};Text(tr("Listening to radio"),Modifier.weight(1f),style=MaterialTheme.typography.titleMedium);Action("close",tr("Back to music")) {command("radio-close")}};Spacer(Modifier.weight(1f));RadioCover(station,200);Text(station.name,style=MaterialTheme.typography.headlineMedium,fontWeight=FontWeight.Bold,maxLines=2,overflow=TextOverflow.Ellipsis);Text(station.description,color=MaterialTheme.colorScheme.onSurfaceVariant);Text(tr("FM Live"),color=MaterialTheme.colorScheme.primary,style=MaterialTheme.typography.labelLarge);if(info.error.isNotEmpty())Text(trMessage(info.error),color=MaterialTheme.colorScheme.error);Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(24.dp)) {Action("previous",tr("Previous station"),enabled=model.radioQueue.size>1) {command("radio-previous")};RadioPlayControl();Action("next",tr("Next station"),enabled=model.radioQueue.size>1) {command("radio-next")}};Row(horizontalArrangement=Arrangement.spacedBy(12.dp)) {Action(if(station.favorite)"liked" else "heart",tr("Favorite this station")) {command("radio-favorite",station.id)};Action("queue",tr("Switch station")) {command("dialog","radio-queue")};TextButton(onClick={command("radio-close")}) {Text(tr("Back to music"))}};Spacer(Modifier.weight(1f))}}
}
@Composable internal fun RadioDialog() {
    if(model.dialog=="radio-queue") {TinglanAlertDialog(onDismissRequest={command("dialog-close")},shape=RoundedCornerShape(26.dp),title={Text(tr("Switch station"))},text={LazyColumn(Modifier.heightIn(max=420.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {items(model.radioQueue,key={it.id}) {station->TextButton(onClick={command("radio-queue-play",station.id)},modifier=Modifier.fillMaxWidth()) {Text(station.name,Modifier.weight(1f),maxLines=1,overflow=TextOverflow.Ellipsis);if(model.radio.station?.id==station.id)Glyph("music",Modifier.size(18.dp))}}}},confirmButton={TextButton(onClick={command("dialog-close")}) {Text(tr("Done"))}});return}
    var name by remember {mutableStateOf("")};var url by remember {mutableStateOf("")}
    TinglanAlertDialog(onDismissRequest={if(!model.radioAdding)command("dialog-close")},shape=RoundedCornerShape(26.dp),title={Text(tr("Add custom station"))},text={Column(verticalArrangement=Arrangement.spacedBy(12.dp)) {TextField(name,{name=it.take(80)},label={Text(tr("Station name"))},singleLine=true,enabled=!model.radioAdding);TextField(url,{url=it.take(4096)},label={Text(tr("HTTPS Audio stream or m3u8 URL"))},maxLines=4,enabled=!model.radioAdding);Text(tr("Saved stations are included in a full backup."),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant);if(model.radioAddError.isNotEmpty())Text(trMessage(model.radioAddError),color=MaterialTheme.colorScheme.error)}},confirmButton={TextButton(onClick={command("radio-add",payload("name" to name,"url" to url))},enabled=name.isNotBlank() && url.isNotBlank() && !model.radioAdding) {Text(if(model.radioAdding)tr("Adding…") else tr("Save station"))}},dismissButton={TextButton(onClick={command("dialog-close")},enabled=!model.radioAdding) {Text(tr("Cancel"))}})
}
