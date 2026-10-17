package dev.tinglan.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.*

@Immutable data class RecognitionItem(val song:Song,val date:String="")
@Immutable data class RecognitionInfo(val phase:String="idle",val busy:Boolean=false,val progress:Float=0f,val error:String="",val notice:String="",val result:Song?=null,val history:List<RecognitionItem> = emptyList(),val historyCount:Int=0,val count:Int=0,val query:String="",val page:Int=0,val pages:Int=1,val mode:String="auto",val localResult:Boolean=false)
internal fun readRecognition(value:JsonElement?):RecognitionInfo {
    val o=value as? JsonObject ?: return RecognitionInfo()
    fun JsonObject.s(k:String)=this[k]?.jsonPrimitive?.contentOrNull ?: ""
    fun JsonObject.n(k:String)=this[k]?.jsonPrimitive?.doubleOrNull ?: 0.0
    fun track(value:JsonElement):Song {val s=value.jsonObject;return Song(s.s("id"),s.s("title"),s.s("artist"),s.s("album"),s.n("durationMs").toLong(),source=s.s("source"),cover=s["hasArtwork"]?.jsonPrimitive?.booleanOrNull==true)}
    return RecognitionInfo(o.s("phase"),o["busy"]?.jsonPrimitive?.booleanOrNull==true,o.n("progress").toFloat(),o.s("error"),o.s("notice"),(o["result"] as? JsonObject)?.let(::track),(o["history"] as? JsonArray)?.take(12)?.map {RecognitionItem(track(it),it.jsonObject.s("date"))} ?: emptyList(),o.n("historyCount").toInt(),o.n("count").toInt(),o.s("query"),o.n("page").toInt(),o.n("pages").toInt().coerceAtLeast(1),o.s("mode"),(o["result"] as? JsonObject)?.s("recognizedVia")=="local")
}
@Composable private fun RecognitionSong(song:Song,date:String="",enabled:Boolean=true) {
    Surface(shape=RoundedCornerShape(16.dp),color=MaterialTheme.colorScheme.surfaceContainerLow) {
        Row(Modifier.fillMaxWidth().padding(12.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
            if(song.cover)Cover(song,40.dp)else Glyph(if(song.source=="local")"music" else song.source,Modifier.size(28.dp),MaterialTheme.colorScheme.primary)
            Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)) {Text(song.title,fontWeight=FontWeight.SemiBold,maxLines=2,overflow=TextOverflow.Ellipsis);Text(song.artist,style=MaterialTheme.typography.bodySmall,maxLines=1,overflow=TextOverflow.Ellipsis);if(date.isNotBlank())Text(date,style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
            Action("play","Play ${song.title}",enabled=enabled) {command("recognition-play",song.id)}
            Action("search","Search platforms ${song.title}",enabled=enabled) {command("recognition-search",song.id)}
        }
    }
}
@Composable internal fun RecognitionDialog() {
    val info=model.recognition
    var historyQuery by remember(info.result?.id,info.historyCount) {mutableStateOf(TextFieldValue(info.query))}
    if(model.dialog=="recognition-clear") {
        TinglanAlertDialog(onDismissRequest={command("recognition-open")},title={Text("Clear recognition history?")},text={Text("Remove recognition history from this browser. Library tracks and exported backups are kept.")},confirmButton={TextButton(onClick={command("recognition-clear-confirm")}) {Text("Clear",color=MaterialTheme.colorScheme.error)}},dismissButton={TextButton(onClick={command("recognition-open")}) {Text("Cancel")}});return
    }
    TinglanAlertDialog(onDismissRequest={command("dialog-close")},title={Text("Identify music")},confirmButton={TextButton(onClick={command("dialog-close")}) {Text(if(info.busy)"Cancel and close" else "Done")}},text={
        Column(Modifier.widthIn(max=520.dp).fillMaxWidth().verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(14.dp)) {
            Column(Modifier.fillMaxWidth().padding(vertical=8.dp),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(12.dp)) {
                Box(Modifier.size(94.dp),contentAlignment=Alignment.Center) {
                    if(info.phase=="listening")CircularProgressIndicator(progress={info.progress},modifier=Modifier.fillMaxSize(),strokeWidth=3.dp)
                    else if(info.busy)CircularProgressIndicator(Modifier.fillMaxSize(),strokeWidth=3.dp)
                    Glyph(if(info.phase=="result")"check" else "recognition",Modifier.size(44.dp),MaterialTheme.colorScheme.primary)
                }
                Text(when(info.phase){"permission"->"Allow microphone access";"listening"->"Listening · ${(info.progress*6).toInt().coerceIn(0,6)} / 6 s";"fingerprinting"->"Computing audio fingerprint";"local-matching"->"Matching local music";"matching"->"Matching online music";"result"->if(info.localResult)"Found a local match" else "Found your song";"no-match"->"No match found";"error"->"Recognition incomplete";else->"Discover music around you"},style=MaterialTheme.typography.titleMedium,fontWeight=FontWeight.SemiBold,modifier=Modifier.semantics {liveRegion=LiveRegionMode.Polite})
                if(info.phase=="no-match")Text("Try a clear vocal or chorus, or choose an audio file.",style=MaterialTheme.typography.bodySmall)
            }
            Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){listOf("auto" to "Local first","offline" to "Local only","online" to "Online only").forEach {(id,label)->FilterChip(selected=info.mode==id,onClick={command("recognition-mode",id)},enabled=!info.busy,label={Text(label)})}}
            Text(when(info.mode){"offline"->"Use this browser’s fingerprints only. No online recognition request.";"online"->"Send an audio fingerprint to NetEase for matching. Original audio is not uploaded.";else->"Match local fingerprints first, then send a fingerprint to NetEase if needed. Original audio is not uploaded."}+"Record six seconds. Tinglan playback pauses during recognition.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            OutlinedButton(onClick={command("local-index-open")},enabled=!info.busy,modifier=Modifier.fillMaxWidth()) {Text("Local fingerprint library · ${model.localIndex.indexed} tracks")}
            if(info.mode=="offline" && model.localIndex.indexed==0)Text("Build fingerprints for local or cached tracks first.",style=MaterialTheme.typography.bodySmall)
            if(info.error.isNotBlank())Text(info.error,color=MaterialTheme.colorScheme.error,modifier=Modifier.semantics {liveRegion=LiveRegionMode.Polite})
            if(info.notice.isNotBlank())Text(info.notice,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.primary)
            if(info.busy)OutlinedButton(onClick={command("recognition-cancel")},modifier=Modifier.fillMaxWidth()) {Text("Cancel recognition")}
            else Row(horizontalArrangement=Arrangement.spacedBy(10.dp)) {
                Button(onClick={command("recognition-start")},enabled=info.mode!="offline" || model.localIndex.indexed>0,modifier=Modifier.weight(1f)) {Text("Start listening")}
                OutlinedButton(onClick={command("recognition-file")},enabled=info.mode!="offline" || model.localIndex.indexed>0,modifier=Modifier.weight(1f)) {Text("Choose audio")}
            }
            info.result?.let {RecognitionSong(it,enabled=!info.busy)}
            if(info.historyCount>0) {
                Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {Text("Recognition history",fontWeight=FontWeight.SemiBold,modifier=Modifier.weight(1f));TextButton(onClick={command("recognition-clear")},enabled=!info.busy) {Text("Clear history")}}
                OutlinedTextField(value=historyQuery,onValueChange={historyQuery=it;command("recognition-query",it.text)},singleLine=true,placeholder={Text("Search recognized tracks or artists")},modifier=Modifier.fillMaxWidth())
                info.history.forEach {RecognitionSong(it.song,it.date,!info.busy)}
                if(info.history.isEmpty())Text("No matching recognition history",style=MaterialTheme.typography.bodySmall)
                if(info.pages>1)Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.SpaceBetween) {TextButton(onClick={command("recognition-page",(info.page-1).toString())},enabled=info.page>0) {Text("Previous")};Text("${info.page+1} / ${info.pages}",style=MaterialTheme.typography.labelMedium);TextButton(onClick={command("recognition-page",(info.page+1).toString())},enabled=info.page+1<info.pages) {Text("Next")}}
            }
        }
    })
}
