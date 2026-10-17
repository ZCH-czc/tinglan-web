@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
package dev.tinglan.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp

/** One opaque dialog surface and visible action feedback across all self-drawn scenes. */
@Composable internal fun TinglanAlertDialog(
    onDismissRequest:()->Unit,
    confirmButton:@Composable ()->Unit,
    dismissButton:(@Composable ()->Unit)?=null,
    title:(@Composable ()->Unit)?=null,
    text:(@Composable ()->Unit)?=null,
    shape:Shape=RoundedCornerShape(26.dp),
    bottomSheet:Boolean=model.dialog in selectionDialogs
) {
    TinglanModalPanel(onDismissRequest=onDismissRequest,shape=if(bottomSheet)RoundedCornerShape(topStart=32.dp,topEnd=32.dp)else shape,
        alignment=if(bottomSheet)Alignment.BottomCenter else Alignment.Center,fromBottom=bottomSheet,color=if(bottomSheet)MaterialTheme.colorScheme.background else MaterialTheme.colorScheme.surfaceContainer) {titleTag ->
        Column(Modifier.padding(horizontal=24.dp,vertical=if(bottomSheet)16.dp else 24.dp),verticalArrangement=Arrangement.spacedBy(20.dp)) {
            if(bottomSheet) {
                var distance by remember {mutableStateOf(0f)}
                Box(Modifier.fillMaxWidth().height(20.dp).pointerInput(Unit) {detectVerticalDragGestures(onDragStart={distance=0f},onVerticalDrag={change,amount->change.consume();distance+=amount},onDragEnd={if(distance>48.dp.toPx())onDismissRequest()})},contentAlignment=Alignment.Center) {
                    Box(Modifier.width(48.dp).height(5.dp).background(MaterialTheme.colorScheme.primary.copy(alpha=.5f),RoundedCornerShape(4.dp)))
                }
            }
            if(title!=null)Box(Modifier.testTag(titleTag).semantics {heading()}) {
                ProvideTextStyle(MaterialTheme.typography.headlineSmall.copy(fontWeight=if(bottomSheet)FontWeight.Bold else FontWeight.Normal)) {title()}
            }
            Box(Modifier.weight(1f,fill=false)) {
                Column(verticalArrangement=Arrangement.spacedBy(12.dp)) {
                    if(text!=null)Box(Modifier.weight(1f,fill=false)) {text()}
                    if(model.toast.isNotEmpty())Surface(shape=RoundedCornerShape(12.dp),color=MaterialTheme.colorScheme.primaryContainer) {
                        Text(trMessage(model.toast),modifier=Modifier.fillMaxWidth().padding(12.dp).semantics {liveRegion=LiveRegionMode.Polite},
                            color=MaterialTheme.colorScheme.onPrimaryContainer,style=MaterialTheme.typography.bodyMedium)
                    }
                    if(model.dialogError.isNotEmpty())Surface(shape=RoundedCornerShape(12.dp),color=MaterialTheme.colorScheme.errorContainer) {
                        Text(trMessage(model.dialogError),modifier=Modifier.fillMaxWidth().padding(12.dp).semantics {liveRegion=LiveRegionMode.Polite},
                            color=MaterialTheme.colorScheme.onErrorContainer,style=MaterialTheme.typography.bodyMedium)
                    }
                }
            }
            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp,Alignment.End),verticalAlignment=Alignment.CenterVertically) {
                dismissButton?.invoke();confirmButton()
            }
        }
    }
}
