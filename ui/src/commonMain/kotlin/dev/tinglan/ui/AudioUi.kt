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
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.*

@Immutable data class SoundSettings(val enabled:Boolean=false,val loudness:Boolean=true,val peakProtection:Boolean=true,val loudnessPreset:String="balanced",val eqEnabled:Boolean=false,val eqPreset:String="flat",val bands:List<Float> = List(5){0f},val outputGainDb:Float=0f,val spatial:Boolean=false,val spatialPreset:String="natural")
@Immutable data class AudioDevice(val id:String,val label:String)
@Immutable data class AudioInfo(val supported:Boolean=false,val status:String="off",val warning:String="",val settings:SoundSettings=SoundSettings(),val outputAvailable:Boolean=false,val canRequest:Boolean=false,val selected:String="",val outputBusy:Boolean=false,val outputWarning:String="")
internal fun readAudioInfo(value:JsonElement?):AudioInfo {
    val o=value as? JsonObject ?: return AudioInfo()
    fun JsonObject.s(k:String,d:String="")=this[k]?.jsonPrimitive?.contentOrNull ?: d
    fun JsonObject.b(k:String)=this[k]?.jsonPrimitive?.booleanOrNull==true
    val s=o["settings"] as? JsonObject ?: JsonObject(emptyMap())
    val output=o["output"] as? JsonObject ?: JsonObject(emptyMap())
    return AudioInfo(o.b("supported"),o.s("status","off"),o.s("warning"),SoundSettings(s.b("enabled"),s.b("loudness"),s.b("peakProtection"),s.s("loudnessPreset","balanced"),s.b("eqEnabled"),s.s("eqPreset","flat"),(s["bands"] as? JsonArray)?.take(5)?.map {it.jsonPrimitive.floatOrNull ?: 0f} ?: List(5){0f},s["outputGainDb"]?.jsonPrimitive?.floatOrNull ?: 0f,s.b("spatial"),s.s("spatialPreset","natural")),output.b("available"),output.b("canRequest"),output.s("selected"),output.b("busy"),output.s("warning"))
}
private fun soundChange(key:String,value:String,index:Int=-1)=command("audio-setting",payload("key" to key,"value" to value,"index" to index.toString()))
@Composable private fun SoundSwitch(title:String,checked:Boolean,enabled:Boolean=true,copy:String="",change:(Boolean)->Unit) {
    FlatSelectableSurface(false,RoundedCornerShape(14.dp),MaterialTheme.colorScheme.surfaceContainerLow,
        modifier=Modifier.fillMaxWidth().semantics {contentDescription=title;stateDescription=if(checked)"Enabled" else "Disabled"},enabled=enabled,onClick={change(!checked)}) {
        Row(Modifier.padding(12.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
            Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)) {Text(title,fontWeight=FontWeight.SemiBold);if(copy.isNotBlank())Text(copy,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
            Switch(checked=checked,onCheckedChange=null,enabled=enabled)
        }
    }
}
@Composable private fun AudioPresets(selected:String,choices:List<Pair<String,String>>,enabled:Boolean,key:String) {
    Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)) {choices.forEach {(id,label)->FilterChip(selected=selected==id,onClick={soundChange(key,id)},enabled=enabled,label={Text(label)})}}
}
@Composable internal fun AudioDialog() {
    val info=model.audioInfo;val s=info.settings;val devices=model.dialog=="audio-devices"
    TinglanAlertDialog(onDismissRequest={command("dialog-close")},title={Text(if(devices)"Playback device" else "Sound & effects")},confirmButton={TextButton(onClick={command("dialog-close")}) {Text("Done")}},text={
        Column(Modifier.widthIn(max=500.dp).fillMaxWidth().verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(14.dp)) {
            if(devices) {
                Text("Choose an authorized output device. Headphones,, USB and Bluetooth availability depend on your system and browser.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                if(info.outputBusy)Row(horizontalArrangement=Arrangement.spacedBy(10.dp),verticalAlignment=Alignment.CenterVertically) {CircularProgressIndicator(Modifier.size(18.dp),strokeWidth=2.dp);Text("Switching playback device…")}
                if(info.outputWarning.isNotBlank())Text(info.outputWarning,color=MaterialTheme.colorScheme.error,modifier=Modifier.semantics {liveRegion=LiveRegionMode.Polite})
                (listOf(AudioDevice("","System default"))+model.audioDevices).forEach {device->
                    SelectionRow(device.label,info.selected==device.id,icon="headphones",enabled=!info.outputBusy){command("audio-device-select",device.id)}
                }
                Button(onClick={command("audio-device-request")},enabled=info.canRequest && !info.outputBusy,modifier=Modifier.fillMaxWidth()) {Text("Choose another device")}
                if(!info.outputAvailable)Text("Your browser cannot switch outputs here. Use system sound settings.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                else if(!info.canRequest)Text("This browser has no output permission picker. Only authorized devices are listed.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                Text(when(info.status){"waiting"->"Enable effects during playback";"starting"->"Preparing audio processing…";"active"->"Effects enabled";"bypass"->"Original audio · Effects unavailable";else->"Original audio"},color=MaterialTheme.colorScheme.primary,modifier=Modifier.semantics {liveRegion=LiveRegionMode.Polite})
                if(info.warning.isNotBlank())Text(info.warning,color=MaterialTheme.colorScheme.error)
                SoundSwitch("Enable audio effects",s.enabled,info.supported || s.enabled,"Turn off for original audio. Music, video audio, radio, and live streams share these settings.") {soundChange("enabled",it.toString())}
                if(!info.supported)Text("Audio worklets are unavailable in this browser. Effects are disabled.",style=MaterialTheme.typography.bodySmall)
                OutlinedButton(onClick={command("audio-devices")},modifier=Modifier.fillMaxWidth()) {Glyph("music",Modifier.size(18.dp));Spacer(Modifier.width(10.dp));Text("Playback device")}
                SoundSwitch("Loudness balancing",s.loudness,s.enabled,"Reduce loud passages without amplifying quiet audio or silence.") {soundChange("loudness",it.toString())}
                AudioPresets(s.loudnessPreset,listOf("balanced" to "Balanced","comfort" to "Comfort","night" to "Night"),s.enabled && s.loudness,"loudnessPreset")
                SoundSwitch("Peak protection",s.peakProtection,s.enabled,"Limit sudden peaks to reduce digital clipping.") {soundChange("peakProtection",it.toString())}
                SoundSwitch("Five-band equalizer",s.eqEnabled,s.enabled) {soundChange("eqEnabled",it.toString())}
                if(s.eqEnabled) {
                    AudioPresets(s.eqPreset,listOf("flat" to "Flat","vocal" to "Vocal","bass" to "Bass","bright" to "Bright"),s.enabled,"eqPreset")
                    listOf("60 Hz","230 Hz","910 Hz","3.6 kHz","14 kHz").forEachIndexed {index,label->val gain=s.bands.getOrElse(index){0f};Column {Text("$label · ${gain.toInt()} dB",style=MaterialTheme.typography.labelMedium);Slider(gain,{soundChange("band",it.toString(),index)},enabled=s.enabled,valueRange=-12f..12f,steps=23,modifier=Modifier.semantics {contentDescription="$label Gain"})}}
                    Text("Reduce overall gain when boosting bands. Use peak protection to avoid overload.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Text("Output gain · ${s.outputGainDb.toInt()} dB",style=MaterialTheme.typography.labelMedium)
                Slider(s.outputGainDb,{soundChange("outputGainDb",it.toString())},enabled=s.enabled,valueRange=-15f..0f,steps=14,modifier=Modifier.semantics {contentDescription="Output gain"})
                SoundSwitch("Stereo tuning",s.spatial,s.enabled,"Adjust stereo width and headphone crossfeed.") {soundChange("spatial",it.toString())}
                if(s.spatial)AudioPresets(s.spatialPreset,listOf("natural" to "Natural","wide" to "Wide","car" to "Car","headphones" to "Headphones"),s.enabled,"spatialPreset")
                TextButton(onClick={soundChange("reset","")}) {Text("Reset tuning")}
            }
        }
    })
}
