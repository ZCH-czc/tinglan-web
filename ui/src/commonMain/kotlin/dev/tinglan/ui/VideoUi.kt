@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
package dev.tinglan.ui

import androidx.compose.animation.*
import androidx.compose.animation.core.tween
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.key.*
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*
import dev.tinglan.core.DanmakuOptions
import dev.tinglan.core.DanmakuPlanner
import kotlinx.coroutines.delay
import kotlinx.serialization.json.*
import kotlin.time.TimeSource

/** Transparent Skia controls above the browser's decoded pixels; no native player chrome. */
@Composable fun VideoControlsScene() {
    if(!model.video.visible)return
    MaterialTheme(colorScheme=darkColorScheme(primary=Color(0xFF86D4DE),onPrimary=Color(0xFF083D47),background=Color(0xFF11191C),surface=Color(0xFF182225),surfaceContainerHigh=Color(0xFF26363B)),typography=applicationTypography()) {
        TinglanModalHost("tinglan-video-controls") {
        var shown by remember {mutableStateOf(true)}
        var menu by remember {mutableStateOf("")}
        var activity by remember {mutableStateOf(0)}
        fun interact(){shown=true;++activity}
        fun seek(delta:Long){interact();command("seek",(videoClock+delta).coerceIn(0L,model.current?.duration?.coerceAtLeast(0L) ?: 0L).toString())}
        val loading=model.video.status in listOf("loading","buffering") || model.status=="buffering"
        val failure=model.video.error.ifBlank {model.error}
        LaunchedEffect(activity,menu,model.dialog,model.video.status,model.status) {
            shown=true
            if(menu.isEmpty() && model.dialog.isEmpty() && model.status=="playing" && model.video.status=="playing") {delay(3000);shown=false}
        }
        BoxWithConstraints(Modifier.fillMaxSize().clearMediaCanvasBackground().onPreviewKeyEvent {event->
            if(menu.isNotEmpty() || model.dialog.isNotEmpty() || event.type!=KeyEventType.KeyUp)false else when(event.key){Key.Spacebar->{interact();command("toggle");true};Key.DirectionLeft->{seek(-10000);true};Key.DirectionRight->{seek(10000);true};else->false}
        }.pointerInput(Unit) {detectTapGestures(onTap={if(shown)shown=false else interact()},onDoubleTap={point->seek(if(point.x<size.width/2)-10000 else 10000)})}) {
            val compact=maxWidth<600.dp
            if(model.danmakuEnabled && model.video.status !in listOf("loading","error","closing")) DanmakuOverlay()
            AnimatedVisibility(shown || loading || failure.isNotEmpty(),enter=fadeIn(tween(motionDuration(120))),exit=fadeOut(tween(motionDuration(180)))) {
                Box(Modifier.fillMaxSize()) {
                    Row(Modifier.align(Alignment.TopCenter).fillMaxWidth().background(Brush.verticalGradient(listOf(Color.Black.copy(alpha=.65f),Color.Transparent))).padding(horizontal=8.dp,vertical=8.dp),verticalAlignment=Alignment.CenterVertically) {
                        VideoAction("back",if(model.video.fullscreen)tr("Exit video fullscreen")else tr("Back to audio player")) {command(if(model.video.fullscreen)"video-fullscreen"else "video-close")}
                        Text(model.current?.title.orEmpty(),Modifier.weight(1f).padding(horizontal=6.dp),maxLines=1,overflow=TextOverflow.Ellipsis,color=Color.White,fontWeight=FontWeight.SemiBold,style=MaterialTheme.typography.titleSmall)
                        if(!compact)VideoAction("comment",tr("View video comments")) {command("comments-open",model.current?.id.orEmpty())}
                        VideoAction("more",tr("More video actions")) {interact();menu="actions"}
                    }
                    Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().background(Brush.verticalGradient(listOf(Color.Transparent,Color.Black.copy(alpha=.72f)))).padding(horizontal=12.dp,vertical=8.dp),verticalArrangement=Arrangement.spacedBy(2.dp)) {
                        VideoSeekBar {interact()}
                        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
                            VideoAction(if(model.status=="playing" || model.status=="waiting-network")"pause"else "play",if(model.status=="playing")tr("Pause video")else tr("Play video"),loading) {interact();if(model.video.status=="error")command("video-retry");command("toggle")}
                            Text("${timestamp(videoClock)} / ${timestamp(model.current?.duration ?: 0)}",color=Color.White.copy(alpha=.9f),style=MaterialTheme.typography.labelMedium,modifier=Modifier.weight(1f).padding(start=6.dp),maxLines=1)
                            if(!compact) {
                                VideoAction("danmaku",if(model.danmakuEnabled)tr("Hide comments overlay")else tr("Show comments overlay"),tint=if(model.danmakuEnabled)MaterialTheme.colorScheme.primary else Color.White) {interact();command("danmaku-toggle")}
                                VideoAction("sliders",tr("Overlay settings")) {interact();menu="danmaku"}
                                VideoAction("playlist",tr("Episodes & video collections")) {interact();command("bili-context-open")}
                                TextButton(onClick={interact();menu="speed"}) {Text("${model.video.rate}×",color=Color.White)}
                            TextButton(onClick={interact();menu="quality"}) {Text(model.video.label.ifBlank {tr("Quality")},color=Color.White)}
                            }
                            VideoAction(if(model.video.fullscreen)"fullscreen-exit"else "fullscreen",if(model.video.fullscreen)tr("Exit video fullscreen")else tr("Enter video fullscreen")) {interact();command("video-fullscreen")}
                        }
                        if(compact)Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.SpaceBetween) {
                            VideoAction("danmaku",if(model.danmakuEnabled)tr("Hide comments overlay")else tr("Show comments overlay"),tint=if(model.danmakuEnabled)MaterialTheme.colorScheme.primary else Color.White) {interact();command("danmaku-toggle")}
                            VideoAction("sliders",tr("Overlay settings")) {interact();menu="danmaku"}
                            VideoAction("playlist",tr("Episodes & video collections")) {interact();command("bili-context-open")}
                            TextButton(onClick={interact();menu="speed"}) {Text("${model.video.rate}×",color=Color.White)}
                            TextButton(onClick={interact();menu="quality"}) {Text(model.video.label.ifBlank {tr("Quality")},color=Color.White)}
                        }
                    }
                }
            }
            if(loading && failure.isEmpty())CircularProgressIndicator(Modifier.align(Alignment.Center).size(32.dp),color=Color.White,strokeWidth=2.dp)
            if(failure.isNotEmpty())Column(Modifier.align(Alignment.Center).widthIn(max=480.dp).padding(24.dp),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(12.dp)) {
                Text(failure,color=Color.White,style=MaterialTheme.typography.bodyMedium)
                Row {TextButton(onClick={command(if(model.status=="error")"retry-play"else "video-retry")}){Text(tr("Reload"))};TextButton(onClick={command("video-close")}){Text(tr("Back to audio"))}}
            }
            if(model.toast.isNotEmpty())Surface(Modifier.align(Alignment.TopCenter).padding(top=64.dp,start=18.dp,end=18.dp),shape=RoundedCornerShape(16.dp),color=Color(0xED303036)) {Text(trMessage(model.toast),Modifier.padding(14.dp),color=Color.White)}
            if(menu=="quality")TinglanAlertDialog(onDismissRequest={menu=""},bottomSheet=true,title={Text(tr("Video quality"))},text={
                Column(Modifier.verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(10.dp)) {
                    Text(tr("Remembers your choice. Only qualities available to your account are used."),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                    model.video.qualities.forEach {q->SelectionRow(q.label,q.id==model.video.quality,if(q.id==model.video.quality)tr("Playing now · {0}", model.video.codec)else ""){command("video-quality",q.id.toString());menu=""}}
                    if(model.video.qualities.isEmpty())Text(tr("Quality options have not loaded yet"))
                }
            },confirmButton={})
            if(menu=="speed")TinglanAlertDialog(onDismissRequest={menu=""},bottomSheet=true,title={Text(tr("Playback speed"))},text={Column(Modifier.verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                listOf(.5f,.75f,1f,1.25f,1.5f,2f).forEach {rate->SelectionRow(if(rate==1f)tr("Normal speed")else "${rate}×",model.video.rate==rate){command("video-rate",rate.toString());menu=""}}
            }},confirmButton={})
            if(menu=="actions")TinglanAlertDialog(onDismissRequest={menu=""},bottomSheet=true,title={Text(tr("Video actions"))},text={Column(Modifier.verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(10.dp)) {
                SelectionRow(tr("Comments"),false,icon="comment"){menu="";command("comments-open",model.current?.id.orEmpty())}
                SelectionRow(tr("Likes & collections"),false,icon="thumb"){menu="";command("bili-actions-open",model.current?.id.orEmpty())}
                SelectionRow(tr("Return to audio playback"),false,icon="headphones"){menu="";command("video-close")}
            }},confirmButton={})
            if(menu=="danmaku")DanmakuSettings {menu=""}
            UpdateToast(Modifier.align(Alignment.TopCenter).padding(top=56.dp))
            if(model.dialog=="bili-context")BilibiliContextDialog()
            if(model.dialog=="bili-actions")BilibiliActionsDialog()
        }
        }
    }
}

@Composable private fun VideoAction(icon:String,label:String,loading:Boolean=false,tint:Color=Color.White,onClick:()->Unit) {
    IconButton(onClick=onClick,modifier=Modifier.size(44.dp).semantics {contentDescription=label}) {
        if(loading)CircularProgressIndicator(Modifier.size(23.dp),color=tint,strokeWidth=2.dp)else Glyph(icon,color=tint)
    }
}

@Composable private fun VideoSeekBar(interact:()->Unit) {
    val total=model.current?.duration ?: 0
    val progressColor=MaterialTheme.colorScheme.primary
    var dragValue by remember(model.current?.id) {mutableStateOf<Float?>(null)}
    val ratio=(videoClock.toFloat()/total.coerceAtLeast(1)).coerceIn(0f,1f)
    Canvas(Modifier.fillMaxWidth().height(32.dp).semantics {
        contentDescription=tr("Video position")
        progressBarRangeInfo=ProgressBarRangeInfo(ratio,0f..1f)
        setProgress {if(total<=0)return@setProgress false;command("seek",(it.coerceIn(0f,1f)*total).toLong().toString());true}
    }.pointerInput(total) {
        if(total<=0)return@pointerInput
        awaitEachGesture {
            val down=awaitFirstDown();down.consume();interact()
            dragValue=(down.position.x/size.width.coerceAtLeast(1)).coerceIn(0f,1f)
            val finished=drag(down.id) {change ->change.consume();dragValue=(change.position.x/size.width.coerceAtLeast(1)).coerceIn(0f,1f)}
            if(finished)command("seek",((dragValue ?: ratio)*total).toLong().toString())
            dragValue=null;interact()
        }
    }) {
        val x=size.width*(dragValue ?: ratio)
        drawLine(Color.White.copy(alpha=.35f),Offset(0f,size.height/2),Offset(size.width,size.height/2),2.dp.toPx(),StrokeCap.Round)
        drawLine(progressColor,Offset(0f,size.height/2),Offset(x,size.height/2),2.dp.toPx(),StrokeCap.Round)
        drawCircle(Color.White,if(dragValue==null)4.dp.toPx() else 6.dp.toPx(),Offset(x,size.height/2))
    }
}

@OptIn(ExperimentalTextApi::class)
@Composable private fun DanmakuOverlay() {
    val planner=remember {DanmakuPlanner()}
    val measurer=rememberTextMeasurer(cacheSize=96)
    val density=LocalDensity.current
    val fontPixels=with(density) {model.danmakuSize.dp.toPx()}
    val options=remember(fontPixels,model.danmakuArea,model.danmakuSpeed,model.danmakuDensity,model.danmakuBlocked) {
        DanmakuOptions(fontPixels,model.danmakuArea,model.danmakuSpeed,model.danmakuDensity,model.danmakuBlocked.split('\n',',').map(String::trim).filter(String::isNotEmpty).take(50))
    }
    val style=MaterialTheme.typography.bodyMedium.copy(fontSize=model.danmakuSize.sp,shadow=Shadow(Color.Black.copy(alpha=.85f),Offset(1f,1f),3f))
    val at=videoClock
    val anchor=remember(at) {TimeSource.Monotonic.markNow()}
    val running=model.status=="playing" && !model.video.background && model.video.status!="closing"
    var tick by remember {mutableStateOf(0L)}
    LaunchedEffect(running,model.danmakuFps) {
        if(running) {
            var last=0L
            val interval=1_000_000_000L/model.danmakuFps.coerceIn(15,60)
            while(true)withFrameNanos {now ->if(last==0L || now-last>=interval){last=now;tick=now}}
        }
    }
    Canvas(Modifier.fillMaxSize()) {
        tick // Only the draw phase observes animation ticks.
        val aspect=model.video.width.toFloat()/model.video.height.coerceAtLeast(1)
        val w=minOf(size.width,size.height*aspect)
        val h=w/aspect
        val left=(size.width-w)/2;val top=(size.height-h)/2
        val position=at+if(running)anchor.elapsedNow().inWholeMilliseconds.coerceIn(0,600)else 0
        clipRect(left,top,left+w,top+h) {
            planner.layout(model.danmaku,position,w,h,options).forEach {row ->
                val text=measurer.measure(row.item.text,style,overflow=TextOverflow.Ellipsis,maxLines=1,constraints=Constraints(maxWidth=row.maxWidth.toInt().coerceAtLeast(1)))
                drawText(text,color=Color(0xff000000L or row.item.color.toLong()).copy(alpha=model.danmakuAlpha),topLeft=Offset(left+row.x,top+row.y))
            }
        }
    }
}

@Composable fun DanmakuSettings(onDismiss:()->Unit) {
    var blocked by remember {mutableStateOf(model.danmakuBlocked)}
    TinglanAlertDialog(onDismissRequest=onDismiss,bottomSheet=true,shape=RoundedCornerShape(26.dp),title={Text(tr("Overlay settings"))},text={
        Column(Modifier.widthIn(max=440.dp).heightIn(max=560.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment=Alignment.CenterVertically) {Text(tr("Show scrolling comments"),Modifier.weight(1f));Switch(checked=model.danmakuEnabled,onCheckedChange={command("danmaku-toggle")})}
            DanmakuSlider(tr("Text size"),"danmakuSize",model.danmakuSize,12f..36f,"${model.danmakuSize.toInt()}")
            DanmakuSlider(tr("Opacity"),"danmakuAlpha",model.danmakuAlpha,.1f..1f,"${(model.danmakuAlpha*100).toInt()}%")
            DanmakuSlider(tr("Display area"),"danmakuArea",model.danmakuArea,.25f..0.85f,"${(model.danmakuArea*100).toInt()}%")
            DanmakuSlider(tr("Speed"),"danmakuSpeed",model.danmakuSpeed,.5f..2f,"${(model.danmakuSpeed*10).toInt()/10f}×")
            DanmakuSlider(tr("On-screen limit"),"danmakuDensity",model.danmakuDensity.toFloat(),4f..24f,tr("{0} items", model.danmakuDensity))
            Text(tr("Comment refresh rate"),fontWeight=FontWeight.Medium)
            Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {listOf(15,30,60).forEach {fps ->FilterChip(selected=model.danmakuFps==fps,onClick={setting("danmakuFps",fps.toString())},label={Text("$fps fps")})}}
            TextField(value=blocked,onValueChange={blocked=it.take(1000)},label={Text(tr("Blocked words, one per line"))},modifier=Modifier.fillMaxWidth(),minLines=2,maxLines=4,shape=RoundedCornerShape(14.dp))
            Text(tr("Default 30 fps; Animations stop while paused or hidden. Settings stay in this browser and are included in backups."),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        }
    },confirmButton={TextButton(onClick={setting("danmakuBlocked",blocked);onDismiss()}) {Text(tr("Done"))}})
}
private fun setting(key:String,value:String)=command("danmaku-setting",buildJsonObject {put("key",key);put("value",value)}.toString())
@Composable private fun DanmakuSlider(label:String,key:String,value:Float,range:ClosedFloatingPointRange<Float>,display:String) {
    var dragValue by remember(key) {mutableStateOf<Float?>(null)}
    Column {
        Row {Text(label,Modifier.weight(1f));Text(display,color=MaterialTheme.colorScheme.onSurfaceVariant)}
        Slider(value=dragValue ?: value,onValueChange={dragValue=it},onValueChangeFinished={setting(key,(dragValue ?: value).toString());dragValue=null},valueRange=range)
    }
}
