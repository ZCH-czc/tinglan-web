package dev.tinglan.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.*
import androidx.compose.ui.unit.dp

/** Small vector set drawn by Skia, shared by every visible control. */
@Composable fun Glyph(name: String, modifier: Modifier = Modifier.size(24.dp), color: Color = MaterialTheme.colorScheme.onSurface) {
    Canvas(modifier) {
        val edge=minOf(size.width,size.height)
        translate((size.width-edge)/2,(size.height-edge)/2) {
        scale(edge / 24f, edge / 24f, Offset.Zero) {
        clipRect(0f,0f,24f,24f) {
            fun line(a: Float, b: Float, c: Float, d: Float) = drawLine(color, Offset(a,b), Offset(c,d), 1.8f, StrokeCap.Round)
            fun circle(x: Float, y: Float, radius: Float) = drawCircle(color, radius, Offset(x,y), style = Stroke(1.8f,cap=StrokeCap.Round,join=StrokeJoin.Round))
            fun box(x: Float, y: Float, w: Float, h: Float) = drawRoundRect(color, Offset(x,y), Size(w,h), androidx.compose.ui.geometry.CornerRadius(2f), style = Stroke(1.8f,cap=StrokeCap.Round,join=StrokeJoin.Round))
            fun triangle(x: Float = 7f) = drawPath(Path().apply { moveTo(x,4f); lineTo(x+12f,12f); lineTo(x,20f); close() }, color)
            when(name) {
                "artwork", "image-error" -> {box(2f,3f,20f,18f);circle(8f,8f,2f);line(3f,19f,10f,12f);line(10f,12f,14f,16f);line(14f,16f,18f,11f);line(18f,11f,21f,15f);if(name=="image-error"){line(4f,2f,21f,22f)}}
                "sun" -> {circle(12f,12f,4f);for(i in 0..7){val a=i*.785398f;line(12f+kotlin.math.cos(a)*8f,12f+kotlin.math.sin(a)*8f,12f+kotlin.math.cos(a)*10f,12f+kotlin.math.sin(a)*10f)}}
                "moon" -> {drawPath(Path().apply {moveTo(18f,18f);cubicTo(6f,23f,-1f,6f,11f,3f);cubicTo(8f,11f,13f,17f,21f,15f);quadraticTo(20f,17f,18f,18f);close()},color,style=Stroke(1.8f,cap=StrokeCap.Round,join=StrokeJoin.Round))}
                "appearance-system" -> {box(2f,3f,20f,14f);line(12f,17f,12f,21f);line(7f,21f,17f,21f);drawRect(color,Offset(4f,5f),Size(8f,10f))}
                "new-release" -> {drawPath(Path().apply {for(i in 0..19){val a=i*.314159f-1.5708f;val r=if(i%2==0)10f else 8.2f;val x=12f+kotlin.math.cos(a)*r;val y=12f+kotlin.math.sin(a)*r;if(i==0)moveTo(x,y)else lineTo(x,y)};close()},color,style=Stroke(1.7f));line(12f,7f,12f,13f);drawCircle(color,1f,Offset(12f,17f))}
                "zoom-in", "zoom-out" -> {circle(10f,10f,7f);line(16f,16f,22f,22f);line(6f,10f,14f,10f);if(name=="zoom-in")line(10f,6f,10f,14f)}
                "fit" -> {box(3f,3f,18f,18f);line(7f,10f,7f,7f);line(7f,7f,10f,7f);line(14f,17f,17f,17f);line(17f,17f,17f,14f)}
                "mute" -> {drawPath(Path().apply {moveTo(3f,9f);lineTo(7f,9f);lineTo(12f,5f);lineTo(12f,19f);lineTo(7f,15f);lineTo(3f,15f);close()},color,style=Stroke(1.8f,cap=StrokeCap.Round,join=StrokeJoin.Round));line(16f,9f,22f,15f);line(22f,9f,16f,15f)}
                "fullscreen-exit" -> {line(9f,3f,9f,9f);line(3f,9f,9f,9f);line(15f,3f,15f,9f);line(15f,9f,21f,9f);line(15f,15f,21f,15f);line(15f,15f,15f,21f);line(3f,15f,9f,15f);line(9f,15f,9f,21f)}
                "sequence" -> {line(3f,5f,16f,5f);line(3f,11f,16f,11f);line(3f,17f,12f,17f);line(20f,4f,20f,20f);line(17f,17f,20f,20f);line(20f,20f,23f,17f)}
                "font" -> {line(4f,20f,11f,3f);line(11f,3f,18f,20f);line(7f,13f,15f,13f);line(17f,9f,23f,9f);line(20f,9f,20f,21f)}
                "lyrics" -> {line(3f,5f,21f,5f);line(3f,12f,17f,12f);line(3f,19f,14f,19f)}
                "play" -> triangle()
                "bili" -> {val path=Path().apply {moveTo(5f,4f);lineTo(19f,4f);quadraticTo(22f,4f,22f,7f);lineTo(22f,18f);quadraticTo(22f,21f,19f,21f);lineTo(5f,21f);quadraticTo(2f,21f,2f,18f);lineTo(2f,7f);quadraticTo(2f,4f,5f,4f);close();moveTo(7f,1f);lineTo(10f,4f);moveTo(17f,1f);lineTo(14f,4f);moveTo(7f,10f);lineTo(7f,15f);moveTo(17f,10f);lineTo(17f,15f);moveTo(9f,17f);quadraticTo(12f,19f,15f,17f)};drawPath(path,color,style=Stroke(1.7f,cap=StrokeCap.Round,join=StrokeJoin.Round))}
                "live" -> {box(3f,7f,18f,14f);line(8f,2f,12f,7f);line(16f,2f,12f,7f);circle(12f,14f,3f)}
                "pause" -> { drawRoundRect(color,Offset(6f,4f),Size(4f,16f),androidx.compose.ui.geometry.CornerRadius(1f)); drawRoundRect(color,Offset(14f,4f),Size(4f,16f),androidx.compose.ui.geometry.CornerRadius(1f)) }
                "next" -> { triangle(4f); line(20f,4f,20f,20f) }
                "previous" -> { drawPath(Path().apply { moveTo(20f,4f); lineTo(7f,12f); lineTo(20f,20f); close() },color); line(4f,4f,4f,20f) }
                "search" -> { circle(10f,10f,6.5f); line(15f,15f,21f,21f) }
                "heart", "liked" -> { val path=Path().apply { moveTo(12f,21f); cubicTo(-4f,10f,4f,-2f,12f,7f); cubicTo(20f,-2f,28f,10f,12f,21f); close() }; drawPath(path,color,style=if(name=="liked") Fill else Stroke(1.8f,cap=StrokeCap.Round,join=StrokeJoin.Round)) }
                "library" -> { box(3f,3f,7f,7f); box(14f,3f,7f,7f); box(3f,14f,7f,7f); box(14f,14f,7f,7f) }
                "home" -> { circle(12f,12f,9f); drawPath(Path().apply { moveTo(16f,7f); lineTo(14f,14f); lineTo(7f,16f); lineTo(10f,10f); close() }, color) }
                "playlist" -> {line(4f,5f,20f,5f);line(4f,12f,20f,12f);line(4f,19f,20f,19f)}
                "queue" -> { line(4f,5f,20f,5f); line(4f,11f,20f,11f); line(4f,17f,12f,17f); drawPath(Path().apply { moveTo(17f,14f); lineTo(23f,18f); lineTo(17f,22f); close() },color) }
                "comment" -> {drawPath(Path().apply {moveTo(3f,3f);lineTo(21f,3f);lineTo(21f,17f);lineTo(9f,17f);lineTo(3f,22f);close()},color,style=Stroke(1.8f,cap=StrokeCap.Round,join=StrokeJoin.Round));line(7f,8f,17f,8f);line(7f,12f,14f,12f)}
                "thumb", "thumb-filled" -> {val path=Path().apply {moveTo(8f,10f);lineTo(12f,3f);cubicTo(14f,2f,16f,3f,14f,10f);lineTo(20f,10f);cubicTo(22f,10f,22f,12f,21f,14f);lineTo(19f,21f);lineTo(8f,21f);close()};drawPath(path,color,style=if(name=="thumb-filled")Fill else Stroke(1.8f,cap=StrokeCap.Round,join=StrokeJoin.Round));box(3f,10f,4f,11f)}
                "feed" -> {box(3f,3f,18f,18f);box(6f,6f,5f,6f);line(14f,7f,18f,7f);line(14f,11f,18f,11f);line(6f,16f,18f,16f)}
                "pin" -> {line(8f,3f,16f,3f);line(9f,3f,9f,11f);line(15f,3f,15f,11f);line(9f,11f,5f,15f);line(5f,15f,19f,15f);line(19f,15f,15f,11f);line(12f,15f,12f,22f)}
                "music" -> { line(10f,4f,10f,17f); line(10f,4f,20f,2f); line(20f,2f,20f,15f); drawOval(color,Offset(3f,14f),Size(7f,6f)); drawOval(color,Offset(13f,12f),Size(7f,6f)) }
                "qq" -> {val path=Path().apply {moveTo(14f,2f);lineTo(20f,2f);lineTo(20f,7f);lineTo(16f,7f);lineTo(16f,16f);cubicTo(16f,20f,11f,23f,7f,21f);cubicTo(3f,19f,4f,14f,8f,13f);cubicTo(10f,12f,12f,12f,14f,13f);close()};drawPath(path,color)}
                "netease" -> {val path=Path().apply {moveTo(16f,3f);cubicTo(10f,-1f,3f,4f,3f,11f);cubicTo(3f,17f,7f,21f,13f,21f);cubicTo(19f,21f,22f,17f,21f,12f);cubicTo(20f,7f,14f,6f,11f,9f);cubicTo(9f,11f,9f,15f,12f,16f);cubicTo(15f,18f,18f,14f,16f,12f);lineTo(14f,9f);lineTo(17f,2f)};drawPath(path,color,style=Stroke(1.7f,cap=StrokeCap.Round,join=StrokeJoin.Round))}
                "album" -> { circle(12f,12f,9f); circle(12f,12f,2f) }
                "recognition" -> {for(i in 0..4){val h=if(i==2)18f else if(i==1 || i==3)12f else 6f;line(4f+i*4f,12f-h/2,4f+i*4f,12f+h/2)}}
                "artist" -> { circle(12f,7f,4f); drawArc(color,180f,180f,false,Offset(4f,13f),Size(16f,14f),style=Stroke(1.8f,cap=StrokeCap.Round,join=StrokeJoin.Round)) }
                "add" -> { line(12f,4f,12f,20f); line(4f,12f,20f,12f) }
                "close" -> { line(6f,6f,18f,18f); line(18f,6f,6f,18f) }
                "lock", "unlock" -> {box(5f,10f,14f,12f);if(name=="lock")drawArc(color,180f,180f,false,Offset(8f,2f),Size(8f,14f),style=Stroke(1.8f,cap=StrokeCap.Round,join=StrokeJoin.Round))else {drawArc(color,180f,180f,false,Offset(9f,2f),Size(10f,14f),style=Stroke(1.8f,cap=StrokeCap.Round,join=StrokeJoin.Round));line(9f,9f,9f,10f)};circle(12f,15f,1.2f);line(12f,16f,12f,18f)}
                "delete" -> {line(4f,5f,20f,5f);line(9f,2f,15f,2f);line(6f,5f,7f,22f);line(7f,22f,17f,22f);line(17f,22f,18f,5f);line(10f,9f,10f,18f);line(14f,9f,14f,18f)}
                "drag" -> {line(5f,9f,19f,9f);line(5f,15f,19f,15f)}
                "shuffle" -> {drawPath(Path().apply {moveTo(3f,5f);lineTo(7f,5f);lineTo(17f,19f);lineTo(21f,19f);moveTo(3f,19f);lineTo(7f,19f);lineTo(17f,5f);lineTo(21f,5f)},color,style=Stroke(1.8f,cap=StrokeCap.Round));line(18f,2f,21f,5f);line(21f,5f,18f,8f);line(18f,16f,21f,19f);line(21f,19f,18f,22f)}
                "repeat-one" -> {drawPath(Path().apply {moveTo(5f,7f);lineTo(20f,7f);lineTo(17f,4f);moveTo(20f,7f);lineTo(17f,10f);moveTo(19f,17f);lineTo(4f,17f);lineTo(7f,14f);moveTo(4f,17f);lineTo(7f,20f)},color,style=Stroke(1.8f,cap=StrokeCap.Round));line(12f,10f,12f,15f)}
                "back" -> { line(15f,5f,8f,12f); line(8f,12f,15f,19f) }
                "chevron" -> {line(9f,5f,16f,12f);line(16f,12f,9f,19f)}
                "up" -> {line(5f,15f,12f,8f);line(12f,8f,19f,15f)}
                "down" -> { line(5f,9f,12f,16f); line(12f,16f,19f,9f) }
                "more" -> { for (y in listOf(5f,12f,19f)) drawCircle(color,1.5f,Offset(12f,y)) }
                "check" -> { line(4f,12f,9f,17f); line(9f,17f,20f,6f) }
                "download" -> { line(12f,3f,12f,16f); line(7f,11f,12f,16f); line(12f,16f,17f,11f); line(4f,20f,20f,20f) }
                "refresh", "repeat" -> { drawArc(color,-45f,290f,false,Offset(4f,4f),Size(16f,16f),style=Stroke(1.8f,cap=StrokeCap.Round,join=StrokeJoin.Round)); line(19f,3f,19f,9f); line(13f,9f,19f,9f) }
                "folder" -> { drawPath(Path().apply { moveTo(3f,7f); lineTo(3f,20f); lineTo(21f,20f); lineTo(21f,6f); lineTo(12f,6f); lineTo(10f,3f); lineTo(3f,3f); close() },color,style=Stroke(1.8f,cap=StrokeCap.Round,join=StrokeJoin.Round)) }
                "settings" -> { circle(12f,12f,4f); circle(12f,12f,8f); for(i in 0..7) { val a=i*0.785398f; line(12f+kotlin.math.cos(a)*8f,12f+kotlin.math.sin(a)*8f,12f+kotlin.math.cos(a)*11f,12f+kotlin.math.sin(a)*11f) } }
                "clock" -> { circle(12f,12f,9f); line(12f,6f,12f,12f); line(12f,12f,16f,15f) }
                "note" -> {box(4f,3f,16f,19f);line(8f,8f,16f,8f);line(8f,12f,16f,12f);line(8f,16f,13f,16f)}
                "fullscreen" -> {line(3f,9f,3f,3f);line(3f,3f,9f,3f);line(15f,3f,21f,3f);line(21f,3f,21f,9f);line(21f,15f,21f,21f);line(21f,21f,15f,21f);line(9f,21f,3f,21f);line(3f,21f,3f,15f)}
                "danmaku" -> {box(2f,3f,20f,16f);line(5f,8f,11f,8f);line(14f,8f,19f,8f);line(5f,13f,17f,13f);line(5f,19f,5f,22f)}
                "account" -> {circle(12f,12f,9f);circle(12f,9f,3f);drawPath(Path().apply {moveTo(5.7f,18.2f);cubicTo(7f,12.8f,17f,12.8f,18.3f,18.2f)},color,style=Stroke(1.8f,cap=StrokeCap.Round,join=StrokeJoin.Round))}
                "palette" -> {val path=Path().apply {moveTo(21f,12f);cubicTo(22f,5f,16f,2f,11f,2f);cubicTo(5f,2f,2f,6f,2f,12f);cubicTo(2f,18f,6f,22f,12f,22f);cubicTo(16f,22f,16f,18f,14f,17f);cubicTo(11f,14f,17f,15f,19f,15f);quadraticTo(21f,15f,21f,12f);close()};drawPath(path,color,style=Stroke(1.8f,join=StrokeJoin.Round));for(p in listOf(Offset(7f,9f),Offset(11f,6f),Offset(16f,7f),Offset(6f,14f)))drawCircle(color,1.25f,p)}
                "motion" -> {line(2f,6f,9f,6f);line(2f,12f,6f,12f);line(2f,18f,9f,18f);drawArc(color,-60f,300f,false,Offset(9f,5f),Size(13f,14f),style=Stroke(1.8f,cap=StrokeCap.Round,join=StrokeJoin.Round));line(18f,2f,20f,6f);line(20f,6f,16f,7f)}
                "expand" -> {box(3f,3f,18f,18f);line(8f,16f,16f,8f);line(10f,8f,16f,8f);line(16f,8f,16f,14f)}
                "volume" -> {val path=Path().apply {moveTo(3f,9f);lineTo(7f,9f);lineTo(12f,5f);lineTo(12f,19f);lineTo(7f,15f);lineTo(3f,15f);close()};drawPath(path,color,style=Stroke(1.8f,join=StrokeJoin.Round));drawArc(color,-55f,110f,false,Offset(10f,7f),Size(9f,10f),style=Stroke(1.8f,cap=StrokeCap.Round,join=StrokeJoin.Round));drawArc(color,-55f,110f,false,Offset(8f,4f),Size(14f,16f),style=Stroke(1.8f,cap=StrokeCap.Round,join=StrokeJoin.Round))}
                "headphones" -> {drawArc(color,180f,180f,false,Offset(3f,3f),Size(18f,18f),style=Stroke(1.8f,cap=StrokeCap.Round,join=StrokeJoin.Round));line(3f,12f,3f,18f);line(21f,12f,21f,18f);box(3f,12f,4f,8f);box(17f,12f,4f,8f)}
                "sliders" -> {line(5f,3f,5f,21f);line(12f,3f,12f,21f);line(19f,3f,19f,21f);for(p in listOf(Offset(5f,8f),Offset(12f,16f),Offset(19f,7f)))drawCircle(color,2.7f,p)}
                "video" -> {box(2f,5f,20f,14f);drawPath(Path().apply {moveTo(10f,9f);lineTo(16f,12f);lineTo(10f,15f);close()},color)}
                "chart" -> {line(3f,3f,3f,21f);line(3f,21f,22f,21f);line(7f,16f,11f,11f);line(11f,11f,15f,14f);line(15f,14f,21f,6f)}
                "radio" -> {box(3f,7f,18f,14f);line(5f,7f,18f,2f);circle(8f,14f,2f);line(14f,12f,18f,12f);line(14f,16f,18f,16f)}
                "backup" -> {box(4f,3f,16f,18f);line(8f,3f,8f,9f);line(8f,9f,16f,9f);line(16f,9f,16f,3f);box(8f,14f,8f,7f)}
                "restore" -> {drawArc(color,-130f,280f,false,Offset(4f,4f),Size(16f,16f),style=Stroke(1.8f,cap=StrokeCap.Round,join=StrokeJoin.Round));line(3f,3f,3f,9f);line(3f,9f,9f,9f);line(12f,7f,12f,12f);line(12f,12f,16f,14f)}
                "cloud-sync" -> {val path=Path().apply {moveTo(6f,17f);cubicTo(0f,17f,0f,9f,6f,9f);cubicTo(6f,1f,18f,1f,19f,9f);cubicTo(24f,10f,23f,16f,20f,17f)};drawPath(path,color,style=Stroke(1.8f,cap=StrokeCap.Round));line(9f,20f,9f,11f);line(6f,14f,9f,11f);line(9f,11f,12f,14f);line(16f,12f,16f,21f);line(13f,18f,16f,21f);line(16f,21f,19f,18f)}
                "network" -> {for(p in listOf(Offset(12f,5f),Offset(5f,18f),Offset(19f,18f)))circle(p.x,p.y,3f);line(12f,8f,12f,12f);line(5f,12f,19f,12f);line(5f,12f,5f,15f);line(19f,12f,19f,15f)}
                "info", "help" -> {circle(12f,12f,9f);if(name=="info"){drawCircle(color,1.2f,Offset(12f,7f));line(12f,11f,12f,17f)}else{drawPath(Path().apply {moveTo(9f,8f);cubicTo(9f,4f,17f,5f,15f,10f);lineTo(12f,13f)},color,style=Stroke(1.8f,cap=StrokeCap.Round));drawCircle(color,1.1f,Offset(12f,17f))}}
                "shield" -> {drawPath(Path().apply {moveTo(12f,2f);lineTo(21f,6f);lineTo(20f,14f);quadraticTo(18f,20f,12f,23f);quadraticTo(6f,20f,4f,14f);lineTo(3f,6f);close()},color,style=Stroke(1.8f,join=StrokeJoin.Round));line(8f,12f,11f,15f);line(11f,15f,16f,9f)}
                "warning" -> {drawPath(Path().apply {moveTo(12f,3f);lineTo(22f,21f);lineTo(2f,21f);close()},color,style=Stroke(1.8f,join=StrokeJoin.Round));line(12f,9f,12f,14f);drawCircle(color,1f,Offset(12f,18f))}
                "qr" -> {box(2f,2f,7f,7f);box(15f,2f,7f,7f);box(2f,15f,7f,7f);line(15f,15f,18f,15f);line(18f,15f,18f,18f);line(15f,18f,15f,22f);line(18f,22f,22f,22f);line(22f,15f,22f,18f)}
                "key" -> {circle(8f,8f,5f);line(12f,12f,21f,21f);line(17f,17f,20f,14f);line(19f,19f,22f,16f)}
                "install" -> {box(4f,2f,16f,20f);line(8f,18f,16f,18f);line(12f,5f,12f,14f);line(8f,10f,12f,14f);line(12f,14f,16f,10f)}
                "bell" -> {drawPath(Path().apply {moveTo(5f,17f);lineTo(7f,14f);lineTo(7f,9f);cubicTo(7f,2f,17f,2f,17f,9f);lineTo(17f,14f);lineTo(19f,17f);close()},color,style=Stroke(1.8f,cap=StrokeCap.Round,join=StrokeJoin.Round));drawArc(color,0f,180f,false,Offset(10f,18f),Size(4f,4f),style=Stroke(1.8f))}
                "update" -> {circle(12f,12f,9f);line(12f,17f,12f,7f);line(8f,11f,12f,7f);line(12f,7f,16f,11f)}
                else -> { for(i in 0..3) line(5f+i*5f,10f-i*2f,5f+i*5f,20f) }
            }
        }
    }
        }
    }
}
