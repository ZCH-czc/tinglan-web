@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
package dev.tinglan.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import moe.rukamori.archivetune.ui.component.PlayerSliderTrack

/** Native track geometry and a full 48 dp input target; the displayed clock follows scrubbing. */
@Composable internal fun PlaybackProgress(interactive:Boolean) {
    val song=model.current
    val total=(song?.duration ?: 0).coerceAtLeast(0)
    val key=model.queueCurrentKey
    var drag by remember(song?.id,key) {mutableStateOf<Float?>(null)}
    val position=clock.coerceIn(0,total.coerceAtLeast(1))
    val shown=(drag?.toLong() ?: position).coerceIn(0,total.coerceAtLeast(1))
    if(interactive) {
        Column(Modifier.fillMaxWidth().guideTarget("player-seek")) {
        val colors=SliderDefaults.colors(inactiveTrackColor=MaterialTheme.colorScheme.primary.copy(alpha=.16f))
        Slider(
            value=drag ?: position.toFloat(),valueRange=0f..total.coerceAtLeast(1).toFloat(),enabled=total>0,
            onValueChange={drag=it},onValueChangeFinished={
                drag?.let {value->command("seek-track",payload("id" to song?.id.orEmpty(),"key" to key,"position" to value.toLong().coerceIn(0,total).toString()))}
                drag=null
            },
            colors=colors,
            modifier=Modifier.fillMaxWidth().heightIn(min=48.dp).semantics {
                contentDescription=tr("Playback position")
                stateDescription=if(total>0)"${timestamp(shown)} / ${timestamp(total)}"else tr("Reading duration")
            },
            track={PlayerSliderTrack(it,colors=colors,trackHeight=4.dp)},
            thumb={Spacer(Modifier.size(width=4.dp,height=16.dp).background(if(total>0)MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface.copy(alpha=.25f),CircleShape))},
        )
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween) {
            Text(timestamp(shown),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            Text(if(total>0)timestamp(total)else "--:--",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        }
        }
    }else LinearProgressIndicator(progress={(position.toFloat()/total.coerceAtLeast(1)).coerceIn(0f,1f)},modifier=Modifier.fillMaxWidth().height(2.dp),color=MaterialTheme.colorScheme.primary,trackColor=Color.Transparent,drawStopIndicator={})
}
