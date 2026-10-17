package dev.tinglan.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.*

@Immutable data class LocalIndexInfo(val building:Boolean=false,val busy:Boolean=false,val waitingDecoder:Boolean=false,val indexed:Int=0,val eligible:Int=0,val bytes:Long=0,val done:Int=0,val total:Int=0,val failed:Int=0,val progress:Float=0f,val title:String="",val kind:String="",val notice:String="",val error:String="")
internal fun readLocalIndex(value:JsonElement?):LocalIndexInfo {
    val o=value as? JsonObject ?: return LocalIndexInfo()
    fun s(k:String)=o[k]?.jsonPrimitive?.contentOrNull ?: ""
    fun n(k:String)=o[k]?.jsonPrimitive?.doubleOrNull ?: 0.0
    fun b(k:String)=o[k]?.jsonPrimitive?.booleanOrNull==true
    return LocalIndexInfo(b("building"),b("busy"),b("waitingDecoder"),n("indexed").toInt(),n("eligible").toInt(),n("bytes").toLong(),n("done").toInt(),n("total").toInt(),n("failed").toInt(),n("progress").toFloat(),s("title"),s("kind"),s("notice"),s("error"))
}
@Composable internal fun LocalIndexDialog(){
    val info=model.localIndex
    if(model.dialog=="local-index-clear"){
        TinglanAlertDialog(onDismissRequest={command("local-index-open")},title={Text("Clear local fingerprints?")},text={Text("Stops the current update and removes rebuildable fingerprint data. Music, playlists, lyrics, and recognition history are kept.")},confirmButton={TextButton(onClick={command("local-index-clear-confirm")}) {Text("Clear",color=MaterialTheme.colorScheme.error)}},dismissButton={TextButton(onClick={command("local-index-open")}) {Text("Cancel")}});return
    }
    TinglanAlertDialog(onDismissRequest={command("recognition-open")},title={Text("Local fingerprint library")},confirmButton={TextButton(onClick={command("recognition-open")}) {Text("Back to recognition")}},text={
        Column(Modifier.widthIn(max=520.dp).fillMaxWidth().verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(14.dp)) {
            Text("${info.indexed} tracks indexed · ${info.eligible} tracks available to analyze",style=MaterialTheme.typography.titleMedium,fontWeight=FontWeight.SemiBold)
            Text("About ${info.bytes/1024} KB fingerprint data",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            Text("Analyze the beginning, middle, and end of local and cached tracks for 40 seconds each. Index up to the most recently added 300 tracks. Completed work is kept; pause and resume at any time.",style=MaterialTheme.typography.bodyMedium)
            Text("Fingerprints stay in this browser. They are not uploaded or backed up and can be rebuilt after restoring music. Keep Tinglan visible during indexing.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            if(info.building){
                Text("${info.done} / ${info.total} · ${info.title}",maxLines=2)
                LinearProgressIndicator(progress={if(info.total>0)((info.done+info.progress)/info.total).coerceIn(0f,1f)else 0f},modifier=Modifier.fillMaxWidth())
                Text(when(info.kind){"sampling"->"Sampling silently. Starting playback pauses this task";"decoding"->"Reading audio track";"analyzing"->"Generating local fingerprints";else->"Checking existing fingerprints"},style=MaterialTheme.typography.bodySmall,modifier=Modifier.semantics {liveRegion=LiveRegionMode.Polite})
                OutlinedButton(onClick={command("local-index-cancel")},modifier=Modifier.fillMaxWidth()) {Text("Pause indexing")}
            }else {
                if(info.waitingDecoder)Text("Releasing the previous analysis. You can continue shortly.",style=MaterialTheme.typography.bodySmall)
                Button(onClick={command("local-index-build")},enabled=!info.busy && !model.recognition.busy && info.eligible>0,modifier=Modifier.fillMaxWidth()) {Text(if(info.indexed>0)"Update fingerprints" else "Build index")}
            }
            if(info.notice.isNotBlank())Text(info.notice,color=MaterialTheme.colorScheme.primary,modifier=Modifier.semantics {liveRegion=LiveRegionMode.Polite})
            if(info.error.isNotBlank())Text(info.error,color=MaterialTheme.colorScheme.error)
            TextButton(onClick={command("local-index-refresh")}) {Text("Refresh status")}
            if(info.indexed>0)TextButton(onClick={command("local-index-clear")}) {Text("Clear fingerprint data")}
        }
    })
}
