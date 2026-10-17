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
        TinglanAlertDialog(onDismissRequest={command("local-index-open")},title={Text(tr("Clear local fingerprints?"))},text={Text(tr("Stops the current update and removes rebuildable fingerprint data. Music, playlists, lyrics, and recognition history are kept."))},confirmButton={TextButton(onClick={command("local-index-clear-confirm")}) {Text(tr("Clear"),color=MaterialTheme.colorScheme.error)}},dismissButton={TextButton(onClick={command("local-index-open")}) {Text(tr("Cancel"))}});return
    }
    TinglanAlertDialog(onDismissRequest={command("recognition-open")},title={Text(tr("Local fingerprint library"))},confirmButton={TextButton(onClick={command("recognition-open")}) {Text(tr("Back to recognition"))}},text={
        Column(Modifier.widthIn(max=520.dp).fillMaxWidth().verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(14.dp)) {
            Text(tr("{0} tracks indexed · {1} tracks available to analyze", info.indexed, info.eligible),style=MaterialTheme.typography.titleMedium,fontWeight=FontWeight.SemiBold)
            Text(tr("About {0} KB fingerprint data", info.bytes/1024),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            Text(tr("Analyze the beginning, middle, and end of local and cached tracks for 40 seconds each. Index up to the most recently added 300 tracks. Completed work is kept; pause and resume at any time."),style=MaterialTheme.typography.bodyMedium)
            Text(tr("Fingerprints stay in this browser. They are not uploaded or backed up and can be rebuilt after restoring music. Keep Tinglan visible during indexing."),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            if(info.building){
                Text("${info.done} / ${info.total} · ${info.title}",maxLines=2)
                LinearProgressIndicator(progress={if(info.total>0)((info.done+info.progress)/info.total).coerceIn(0f,1f)else 0f},modifier=Modifier.fillMaxWidth())
                Text(when(info.kind){"sampling"->tr("Sampling silently. Starting playback pauses this task");"decoding"->tr("Reading audio track");"analyzing"->tr("Generating local fingerprints");else->tr("Checking existing fingerprints")},style=MaterialTheme.typography.bodySmall,modifier=Modifier.semantics {liveRegion=LiveRegionMode.Polite})
                OutlinedButton(onClick={command("local-index-cancel")},modifier=Modifier.fillMaxWidth()) {Text(tr("Pause indexing"))}
            }else {
                if(info.waitingDecoder)Text(tr("Releasing the previous analysis. You can continue shortly."),style=MaterialTheme.typography.bodySmall)
                Button(onClick={command("local-index-build")},enabled=!info.busy && !model.recognition.busy && info.eligible>0,modifier=Modifier.fillMaxWidth()) {Text(if(info.indexed>0)tr("Update fingerprints") else tr("Build index"))}
            }
            if(info.notice.isNotBlank())Text(trMessage(info.notice),color=MaterialTheme.colorScheme.primary,modifier=Modifier.semantics {liveRegion=LiveRegionMode.Polite})
            if(info.error.isNotBlank())Text(trMessage(info.error),color=MaterialTheme.colorScheme.error)
            TextButton(onClick={command("local-index-refresh")}) {Text(tr("Refresh status"))}
            if(info.indexed>0)TextButton(onClick={command("local-index-clear")}) {Text(tr("Clear fingerprint data"))}
        }
    })
}
