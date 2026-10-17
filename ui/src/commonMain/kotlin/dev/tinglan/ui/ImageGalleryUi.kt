package dev.tinglan.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.*
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.*
import androidx.compose.ui.input.key.*
import androidx.compose.ui.input.pointer.*
import androidx.compose.ui.layout.*
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.*
import kotlinx.serialization.json.*

@Immutable data class GalleryInfo(val open:Boolean=false,val keys:List<String> = emptyList(),val index:Int=0,val status:String="idle",val error:String="")
internal fun openPictures(keys:List<String>,index:Int) = command("gallery-open",buildJsonObject {put("keys",JsonArray(keys.map(::JsonPrimitive)));put("index",index)}.toString())

@Composable internal fun ImageGalleryPanel() {
    val gallery=model.gallery
    if(!gallery.open)return
    var scale by remember(gallery.index,gallery.keys) {mutableStateOf(1f)}
    var pan by remember(gallery.index,gallery.keys) {mutableStateOf(Offset.Zero)}
    val revision=artRevision
    val image=artworkFor(gallery.keys.getOrNull(gallery.index).orEmpty()+":gallery")
    fun step(delta:Int){command("gallery-step",delta.toString())}
    fun zoom(value:Float){scale=value.coerceIn(1f,4f);pan=Offset.Zero}
    TinglanModalPanel(identity="image-gallery",onDismissRequest={command("gallery-close")},width=2400.dp,fullHeight=true,color=Color(0xFF0D1012),shape=RectangleShape) {
        Column(Modifier.fillMaxSize().onPreviewKeyEvent {event->if(event.type==KeyEventType.KeyUp)when(event.key){Key.DirectionLeft->{step(-1);true};Key.DirectionRight->{step(1);true};else->false}else false}) {
            Row(Modifier.fillMaxWidth().padding(horizontal=10.dp,vertical=6.dp),verticalAlignment=Alignment.CenterVertically) {
                Action("close",tr("Close image viewer"),color=Color.White){command("gallery-close")}
                Text("${gallery.index+1} / ${gallery.keys.size}",Modifier.weight(1f),color=Color.White,style=MaterialTheme.typography.titleMedium)
                Action("zoom-out",tr("Zoom out"),color=Color.White,enabled=scale>1f){zoom(scale-.5f)}
                Action("zoom-in",tr("Zoom in"),color=Color.White,enabled=scale<4f){zoom(scale+.5f)}
                Action("fit",tr("Reset zoom"),color=Color.White){zoom(1f)}
            }
            BoxWithConstraints(Modifier.weight(1f).fillMaxWidth().clipToBounds(),contentAlignment=Alignment.Center) {
                val density=androidx.compose.ui.platform.LocalDensity.current
                val width=with(density){maxWidth.toPx()};val height=with(density){maxHeight.toPx()}
                val fit=if(image==null)1f else minOf(width/image.width,height/image.height)
                fun bounded(offset:Offset,zoom:Float):Offset {
                    val x=maxOf(0f,((image?.width ?: 0)*fit*zoom-width)/2);val y=maxOf(0f,((image?.height ?: 0)*fit*zoom-height)/2)
                    return Offset(offset.x.coerceIn(-x,x),offset.y.coerceIn(-y,y))
                }
                if(image!=null && gallery.status=="ready")Image(image,tr("Post image {0}", gallery.index+1),Modifier.fillMaxSize()
                    .pointerInput(gallery.index,width,height) {detectTapGestures(onDoubleTap={zoom(if(scale>1f)1f else 2.5f)})}
                    .pointerInput(gallery.index,width,height) {
                        awaitEachGesture {
                            awaitFirstDown(requireUnconsumed=false);var displacement=Offset.Zero;var transformed=false;var maxPointers=1
                            do {
                                val event=awaitPointerEvent();maxPointers=maxOf(maxPointers,event.changes.size)
                                val delta=event.calculatePan();val factor=event.calculateZoom()
                                if(factor!=1f || scale>1f) {scale=(scale*factor).coerceIn(1f,4f);pan=bounded(pan+delta,scale);transformed=true}
                                else displacement+=delta
                                if(transformed || displacement.getDistance()>viewConfiguration.touchSlop)event.changes.forEach {it.consume()}
                            }while(event.changes.any {it.pressed})
                            if(!transformed && maxPointers==1 && kotlin.math.abs(displacement.x)>64.dp.toPx() && kotlin.math.abs(displacement.x)>kotlin.math.abs(displacement.y)*1.4f)step(if(displacement.x<0)1 else -1)
                        }
                    }.graphicsLayer {scaleX=scale;scaleY=scale;translationX=bounded(pan,scale).x;translationY=bounded(pan,scale).y},contentScale=ContentScale.Fit)
                if(gallery.status=="loading")CircularProgressIndicator(Modifier.size(30.dp),color=Color.White,strokeWidth=2.dp)
                if(gallery.status=="error")Column(Modifier.padding(24.dp),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(12.dp)) {Glyph("image-error",Modifier.size(40.dp),Color.White);Text(trMessage(gallery.error),color=Color.White);TextButton(onClick={command("gallery-retry")}){Text(tr("Reload"))}}
            }
            Row(Modifier.fillMaxWidth().padding(horizontal=16.dp,vertical=10.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.SpaceBetween) {
                Action("back",tr("Previous image"),color=Color.White,enabled=gallery.index>0){step(-1)}
                Text(tr("Swipe to browse · Double-tap or pinch to zoom"),color=Color.White.copy(alpha=.7f),style=MaterialTheme.typography.labelSmall)
                Action("chevron",tr("Next image"),color=Color.White,enabled=gallery.index<gallery.keys.lastIndex){step(1)}
            }
        }
    }
}
