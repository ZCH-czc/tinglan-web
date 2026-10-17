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
        modifier=Modifier.fillMaxWidth().semantics {contentDescription=title;stateDescription=if(checked)tr("Enabled") else tr("Disabled")},enabled=enabled,onClick={change(!checked)}) {
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
    TinglanAlertDialog(onDismissRequest={command("dialog-close")},title={Text(if(devices)tr("Playback device") else tr("Sound & effects"))},confirmButton={TextButton(onClick={command("dialog-close")}) {Text(tr("Done"))}},text={
        Column(Modifier.widthIn(max=500.dp).fillMaxWidth().verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(14.dp)) {
            if(devices) {
                Text(tr("Choose an authorized output device. Headphones,, USB and Bluetooth availability depend on your system and browser."),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                if(info.outputBusy)Row(horizontalArrangement=Arrangement.spacedBy(10.dp),verticalAlignment=Alignment.CenterVertically) {CircularProgressIndicator(Modifier.size(18.dp),strokeWidth=2.dp);Text(tr("Switching playback device…"))}
                if(info.outputWarning.isNotBlank())Text(trMessage(info.outputWarning),color=MaterialTheme.colorScheme.error,modifier=Modifier.semantics {liveRegion=LiveRegionMode.Polite})
                (listOf(AudioDevice("",tr("System default")))+model.audioDevices).forEach {device->
                    SelectionRow(device.label,info.selected==device.id,icon="headphones",enabled=!info.outputBusy){command("audio-device-select",device.id)}
                }
                Button(onClick={command("audio-device-request")},enabled=info.canRequest && !info.outputBusy,modifier=Modifier.fillMaxWidth()) {Text(tr("Choose another device"))}
                if(!info.outputAvailable)Text(tr("Your browser cannot switch outputs here. Use system sound settings."),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                else if(!info.canRequest)Text(tr("This browser has no output permission picker. Only authorized devices are listed."),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                Text(when(info.status){"waiting"->tr("Enable effects during playback");"starting"->tr("Preparing audio processing…");"active"->tr("Effects enabled");"bypass"->tr("Original audio · Effects unavailable");else->tr("Original audio")},color=MaterialTheme.colorScheme.primary,modifier=Modifier.semantics {liveRegion=LiveRegionMode.Polite})
                if(info.warning.isNotBlank())Text(trMessage(info.warning),color=MaterialTheme.colorScheme.error)
                SoundSwitch(tr("Enable audio effects"),s.enabled,info.supported || s.enabled,tr("Turn off for original audio. Music, video audio, radio, and live streams share these settings.")) {soundChange("enabled",it.toString())}
                if(!info.supported)Text(tr("Audio worklets are unavailable in this browser. Effects are disabled."),style=MaterialTheme.typography.bodySmall)
                OutlinedButton(onClick={command("audio-devices")},modifier=Modifier.fillMaxWidth()) {Glyph("music",Modifier.size(18.dp));Spacer(Modifier.width(10.dp));Text(tr("Playback device"))}
                SoundSwitch(tr("Loudness balancing"),s.loudness,s.enabled,tr("Reduce loud passages without amplifying quiet audio or silence.")) {soundChange("loudness",it.toString())}
                AudioPresets(s.loudnessPreset,listOf("balanced" to tr("Balanced"),"comfort" to tr("Comfort"),"night" to tr("Night")),s.enabled && s.loudness,"loudnessPreset")
                SoundSwitch(tr("Peak protection"),s.peakProtection,s.enabled,tr("Limit sudden peaks to reduce digital clipping.")) {soundChange("peakProtection",it.toString())}
                SoundSwitch(tr("Five-band equalizer"),s.eqEnabled,s.enabled) {soundChange("eqEnabled",it.toString())}
                if(s.eqEnabled) {
                    AudioPresets(s.eqPreset,listOf("flat" to tr("Flat"),"vocal" to tr("Vocal"),"bass" to tr("Bass"),"bright" to tr("Bright")),s.enabled,"eqPreset")
                    listOf("60 Hz","230 Hz","910 Hz","3.6 kHz","14 kHz").forEachIndexed {index,label->val gain=s.bands.getOrElse(index){0f};Column {Text("$label · ${gain.toInt()} dB",style=MaterialTheme.typography.labelMedium);Slider(gain,{soundChange("band",it.toString(),index)},enabled=s.enabled,valueRange=-12f..12f,steps=23,modifier=Modifier.semantics {contentDescription=tr("{0} Gain", label)})}}
                    Text(tr("Reduce overall gain when boosting bands. Use peak protection to avoid overload."),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Text(tr("Output gain · {0} dB", s.outputGainDb.toInt()),style=MaterialTheme.typography.labelMedium)
                Slider(s.outputGainDb,{soundChange("outputGainDb",it.toString())},enabled=s.enabled,valueRange=-15f..0f,steps=14,modifier=Modifier.semantics {contentDescription=tr("Output gain")})
                SoundSwitch(tr("Stereo tuning"),s.spatial,s.enabled,tr("Adjust stereo width and headphone crossfeed.")) {soundChange("spatial",it.toString())}
                if(s.spatial)AudioPresets(s.spatialPreset,listOf("natural" to tr("Natural"),"wide" to tr("Wide"),"car" to tr("Car"),"headphones" to tr("Headphones")),s.enabled,"spatialPreset")
                TextButton(onClick={soundChange("reset","")}) {Text(tr("Reset tuning"))}
            }
        }
    })
}
