package dev.tinglan.ui

import androidx.compose.animation.*
import androidx.compose.animation.core.tween
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.*
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.key.*
import androidx.compose.ui.layout.*
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*
import kotlinx.coroutines.delay

@Composable internal fun LivePage(data:UiModel) {
    val live=data.live
    val density=LocalDensity.current.density
    LazyColumn(state=retainedContentScroll(data.viewKey),modifier=Modifier.fillMaxSize(),contentPadding=PaddingValues(bottom=120.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
        item {Row(Modifier.fillMaxWidth().padding(horizontal=12.dp,vertical=8.dp),verticalAlignment=Alignment.CenterVertically) {Action("back","Leave live stream and return") {command("page-back")};Text("Bilibili Live",Modifier.weight(1f),style=MaterialTheme.typography.titleLarge);Action("refresh","Reload live stream") {command("live-retry")}}}
        item {
            Box(Modifier.fillMaxWidth().padding(horizontal=16.dp).aspectRatio(16f/9f).clip(RoundedCornerShape(16.dp)).background(Color.Black).onGloballyPositioned {c->
                val r=c.boundsInWindow();val p=c.positionInWindow();val size=c.size
                command("live-bounds",payload("id" to live.roomId,"x" to (p.x/density).toString(),"y" to (p.y/density).toString(),"width" to (size.width/density).toString(),"height" to (size.height/density).toString(),"clipTop" to ((r.top-p.y).coerceAtLeast(0f)/density).toString(),"clipBottom" to ((p.y+size.height-r.bottom).coerceAtLeast(0f)/density).toString()))
            },contentAlignment=Alignment.Center) {Glyph("bili",Modifier.size(36.dp),Color.White.copy(alpha=.6f))}
        }
        item {Column(Modifier.fillMaxWidth().padding(horizontal=24.dp),verticalArrangement=Arrangement.spacedBy(14.dp)) {
            Text(live.title.ifBlank {"Loading live room…"},style=MaterialTheme.typography.headlineSmall,fontWeight=FontWeight.Bold)
            if(live.title.isNotEmpty())Text(if(live.live)"Live now · ${live.viewers} Popularity · ${live.area}" else "Offline",color=MaterialTheme.colorScheme.onSurfaceVariant,style=MaterialTheme.typography.bodySmall)
            if(live.creatorId.isNotEmpty())TextButton(onClick={command("creator-direct",payload("id" to live.creatorId,"source" to "bili"))}) {Text("${live.creatorName} · View UP creator")}
            if(live.description.isNotBlank())RichContentText(live.description,emptyList())
            if(live.background)Text("Page hidden. Stream downloading and decoding are paused",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        }}
    }
}

@Composable private fun LiveAction(icon:String,label:String,loading:Boolean=false,onClick:()->Unit) {
    IconButton(onClick=onClick,modifier=Modifier.size(44.dp).semantics {contentDescription=label}) {if(loading)CircularProgressIndicator(Modifier.size(22.dp),color=Color.White,strokeWidth=2.dp)else Glyph(icon,color=Color.White)}
}
@Composable internal fun LiveQualityDialog(dismiss:()->Unit) {
    TinglanAlertDialog(onDismissRequest=dismiss,bottomSheet=true,title={Text("Live quality")},text={Column(Modifier.verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(10.dp)) {
        if(model.live.qualities.isEmpty())Text("No selectable quality available")
        model.live.qualities.forEach {q->SelectionRow(q.label,q.id==model.live.quality){command("live-quality",q.id.toString());dismiss()}}
    }},confirmButton={TextButton(onClick=dismiss) {Text("Close")}})
}
@Composable internal fun LiveLinkDialog() {
    var text by remember {mutableStateOf("")}
    TinglanAlertDialog(onDismissRequest={command("dialog-close")},title={Text("Open live stream")},text={Column(verticalArrangement=Arrangement.spacedBy(12.dp)) {
        Text("Enter Bilibili room ID or paste a live.bilibili.com live-stream URL.")
        OutlinedTextField(text,{text=it.take(512)},label={Text("Room ID or URL")},singleLine=true,modifier=Modifier.fillMaxWidth())
    }},confirmButton={TextButton(onClick={command("dialog-save",text)},enabled=text.isNotBlank()) {Text("Watch live")}},dismissButton={TextButton(onClick={command("dialog-close")}) {Text("Cancel")}})
}

@Composable internal fun LiveControlsScene() {
    MaterialTheme(colorScheme=darkColorScheme(primary=Color(0xFF86D4DE),onPrimary=Color(0xFF083D47),background=Color(0xFF11191C),surfaceContainerHigh=Color(0xFF26363B)),typography=applicationTypography()) {
        TinglanModalHost("tinglan-live-controls") {
        val live=model.live
        var visible by remember(live.roomId) {mutableStateOf(true)}
        var menu by remember(live.roomId) {mutableStateOf(false)}
        var touch by remember {mutableStateOf(0)}
        val loading=live.status in listOf("loading","buffering","reconnecting")
        LaunchedEffect(live.roomId,live.status,touch,menu) {if(live.status=="playing" && !menu){delay(3200);visible=false}else visible=true}
        Box(Modifier.fillMaxSize().clearMediaCanvasBackground().onPreviewKeyEvent {event->
            if(menu || event.type!=KeyEventType.KeyUp)false else when(event.key) {
                Key.Spacebar->{visible=true;touch++;command("live-toggle");true}
                Key.F->{visible=true;touch++;command("live-fullscreen");true}
                else->false
            }
        }.pointerInput(live.roomId) {detectTapGestures(onTap={visible=!visible;touch++},onDoubleTap={visible=true;touch++;command("live-fullscreen")})}) {
            AnimatedVisibility(visible,enter=fadeIn(tween(if(model.reduced)0 else 140)),exit=fadeOut(tween(if(model.reduced)0 else 120))) {
                Box(Modifier.fillMaxSize()) {
                    Row(Modifier.align(Alignment.TopCenter).fillMaxWidth().background(Brush.verticalGradient(listOf(Color.Black.copy(alpha=.6f),Color.Transparent))).padding(horizontal=8.dp,vertical=4.dp),verticalAlignment=Alignment.CenterVertically) {
                        LiveAction("back",if(live.fullscreen)"Exit live fullscreen"else "Leave stream and restore music") {command(if(live.fullscreen)"live-fullscreen"else "page-back")}
                        Text(live.title,Modifier.weight(1f),color=Color.White,maxLines=1,overflow=TextOverflow.Ellipsis,style=MaterialTheme.typography.labelLarge)
                    }
                    Row(Modifier.align(Alignment.BottomCenter).fillMaxWidth().background(Brush.verticalGradient(listOf(Color.Transparent,Color.Black.copy(alpha=.65f)))).padding(horizontal=8.dp,vertical=4.dp),verticalAlignment=Alignment.CenterVertically) {
                        LiveAction(if(live.desired)"pause" else "play","Play or pause stream",loading) {touch++;command("live-toggle")}
                        Text(if(live.status=="reconnecting")"Reconnecting"else if(live.status=="playing")"Live"else "Live",Modifier.weight(1f),color=Color.White,style=MaterialTheme.typography.labelMedium)
                        LiveAction(if(live.muted)"mute"else "volume",if(live.muted)"Unmute stream"else "Mute stream") {touch++;command("live-mute")}
                        TextButton(onClick={touch++;if(live.fullscreen)menu=true else command("live-quality-menu")}) {Text(live.label.ifBlank {"Quality"},color=Color.White)}
                        LiveAction(if(live.fullscreen)"fullscreen-exit"else "fullscreen",if(live.fullscreen)"Exit live fullscreen"else "Enter live fullscreen") {touch++;command("live-fullscreen")}
                    }
                }
            }
            if(loading && live.error.isBlank())CircularProgressIndicator(Modifier.align(Alignment.Center).size(30.dp),color=Color.White,strokeWidth=2.dp)
            if(live.notice.isNotBlank() && loading)Text(live.notice,Modifier.align(Alignment.Center).padding(top=70.dp),color=Color.White,style=MaterialTheme.typography.bodySmall)
            if(live.error.isNotBlank())Column(Modifier.align(Alignment.Center).padding(horizontal=20.dp),horizontalAlignment=Alignment.CenterHorizontally) {
                Text(live.error,color=Color.White,style=MaterialTheme.typography.bodySmall,maxLines=3,overflow=TextOverflow.Ellipsis)
                TextButton(onClick={command(if(live.status=="paused")"live-toggle" else "live-retry")}) {Text(if(live.status=="paused")"Play stream" else "Reload")}
            }
            if(menu)LiveQualityDialog {menu=false}
            if(live.fullscreen)UpdateToast(Modifier.align(Alignment.TopCenter).padding(top=48.dp))
        }
        }
    }
}
