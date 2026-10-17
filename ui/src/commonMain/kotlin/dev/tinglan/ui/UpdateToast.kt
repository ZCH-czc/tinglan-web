package dev.tinglan.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/** Kept visible until acknowledged, including above both native video surfaces. */
@Composable internal fun UpdateToast(modifier:Modifier=Modifier) {
    if(!model.updatePrompt)return
    Surface(modifier.widthIn(max=520.dp).fillMaxWidth().padding(horizontal=14.dp),shape=RoundedCornerShape(22.dp),color=MaterialTheme.colorScheme.surfaceContainerHigh,shadowElevation=2.dp) {
        Column(Modifier.padding(start=18.dp,end=10.dp,top=14.dp,bottom=6.dp).semantics {liveRegion=LiveRegionMode.Polite},verticalArrangement=Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(10.dp)) {
                Glyph("update",color=MaterialTheme.colorScheme.primary)
                Column(Modifier.weight(1f)) {
                    Text(if(model.updateApplying)tr("Applying update…") else tr("A new Tinglan version is ready"),fontWeight=FontWeight.SemiBold)
                    Text(tr("Updating saves your position and reloads the page"),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.End) {
                TextButton(onClick={command("update-dismiss")},enabled=!model.updateApplying) {Text(tr("Later"))}
                TextButton(onClick={command("apply-update")},enabled=!model.updateApplying) {Text(tr("Update now"))}
            }
        }
    }
}
