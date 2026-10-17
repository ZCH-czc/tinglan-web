package dev.tinglan.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

internal val selectionDialogs=setOf("language","theme","search-preference","font","motion-preset","lyrics-appearance","guides","library-options","library-order","playlist-add","playlist-menu","playback-order","lyric-source","audio-devices","cache-budget","live-quality","danmaku-settings","bili-context","bili-actions","radio-queue")

/** A whole-row target with one unambiguous selection indicator, matching Android choices. */
@Composable internal fun SelectionRow(label:String,selected:Boolean,description:String="",icon:String="",enabled:Boolean=true,onClick:()->Unit) {
    val colors=MaterialTheme.colorScheme
    val foreground=if(selected)colors.onPrimary else colors.onSurface
    Surface(onClick=onClick,enabled=enabled,shape=RoundedCornerShape(28.dp),
        color=if(selected)colors.primary else colors.surfaceContainerHigh,contentColor=foreground,
        modifier=Modifier.fillMaxWidth().semantics {this.selected=selected;role=Role.RadioButton}) {
        Row(Modifier.heightIn(min=64.dp).padding(horizontal=22.dp,vertical=16.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(14.dp)) {
            if(icon.isNotEmpty())Glyph(icon,color=foreground)
            Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(5.dp)) {
                Text(label,style=MaterialTheme.typography.titleMedium,fontWeight=if(selected)FontWeight.SemiBold else FontWeight.Normal)
                if(description.isNotBlank())Text(description,style=MaterialTheme.typography.bodyMedium,color=if(selected)foreground.copy(alpha=.8f)else colors.onSurfaceVariant)
            }
            if(selected)Glyph("check",color=foreground)else Spacer(Modifier.size(23.dp))
        }
    }
}

@Composable internal fun BasicChoiceSheet() {
    val theme=model.dialog=="theme"
    TinglanAlertDialog(onDismissRequest={command("dialog-close")},bottomSheet=true,
        title={Text(if(theme)tr("Appearance")else tr("Search preferences"))},text={
            Column(Modifier.verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(10.dp)) {
                if(theme)listOf(Triple("system",tr("Follow system"),tr("Match your device's light or dark appearance")),Triple("light",tr("Light"),tr("A bright, clear interface")),Triple("dark",tr("Dark"),tr("A softer, dark interface"))).forEach {(id,label,copy)->
                    SelectionRow(label,model.theme==id,copy,when(id){"system"->"appearance-system";"light"->"sun";else->"moon"}) {command("setting",payload("key" to "theme","value" to id));command("dialog-close")}
                }else {
                    Text(tr("Show the preferred platform first. Other platform results can still be expanded."),style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
                    listOf("qq","bili","netease").forEach {id->SelectionRow(platformName(id),model.searchPreference==id,icon=id){command("setting",payload("key" to "searchPreference","value" to id));command("dialog-close")}}
                }
            }
        },confirmButton={})
}
