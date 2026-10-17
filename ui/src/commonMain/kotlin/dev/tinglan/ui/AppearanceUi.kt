package dev.tinglan.ui
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.*

@Composable internal fun AppearanceDialog() {
    val kind=model.dialog
    TinglanAlertDialog(onDismissRequest={command("dialog-close")},title={Text(when(kind){"font"->"App font";"motion-preset"->"Animation speed";"lyrics-appearance"->"Lyrics text size";else->"Feature guides"})},text={
        Column(Modifier.widthIn(max=480.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(12.dp)) {
            when(kind) {
                "font"->{
                    Text("Fonts download on first use and remain available offline.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                    listOf("sans" to "Noto Sans SC","serif" to "Noto Serif SC","wenkai" to "LXGW WenKai","nunito" to "Nunito · Noto Sans SC for Chinese text").forEach {(key,label)->SelectionRow(label,model.font==key){command("setting",payload("key" to "font","value" to key))}}
                    Text("Hear the music. Find your rhythm.",fontWeight=FontWeight.SemiBold,fontSize=23.sp,modifier=Modifier.padding(vertical=12.dp))
                }
                "motion-preset"->{listOf("fast" to "Fast · Default","slow" to "Relaxed").forEach {(key,label)->SelectionRow(label,model.motionPreset==key){command("setting",payload("key" to "motionPreset","value" to key))}};Text("Enable“Reduce motion”takes priority over animation preferences.",style=MaterialTheme.typography.bodySmall)}
                "lyrics-appearance"->{
                    var size by remember {mutableStateOf(model.lyricsSize.toFloat())}
                    Text("Lyrics text size ${size.toInt()}")
                    Slider(size,{size=it},onValueChangeFinished={command("setting",payload("key" to "lyricsSize","value" to size.toInt().toString()))},valueRange=18f..40f,steps=21)
                    Text("Make every lyric easy to read",fontSize=size.sp,lineHeight=(size*1.5f).sp,modifier=Modifier.padding(vertical=14.dp))
                }
                else->{Row(verticalAlignment=Alignment.CenterVertically){Text("Show on first visit",Modifier.weight(1f));Switch(model.guideEnabled,{command("setting",payload("key" to "guideEnabled","value" to it.toString()))})};Text("Guides bring the target into view and pause scrolling. Completed tips are not shown again.",style=MaterialTheme.typography.bodyMedium);TextButton(onClick={command("guide-reset")}){Text("Reset feature guides")}}
            }
        }
    },confirmButton={TextButton(onClick={command("dialog-close")}){Text("Done")}})
}
