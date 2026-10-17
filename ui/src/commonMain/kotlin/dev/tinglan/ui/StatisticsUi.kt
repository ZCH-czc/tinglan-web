package dev.tinglan.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlin.math.*

@Immutable data class StatisticsPoint(val label:String,val value:Long)
@Immutable data class StatisticsRank(val key:String,val label:String,val songId:String,val source:String,val creatorId:String,val totalMs:Long,val plays:Int)
@Immutable data class StatisticsReport(val label:String,val totalMs:Long,val plays:Int,val songCount:Int,val artistCount:Int,val days:Int,val averageMs:Long,val points:List<StatisticsPoint>,val hours:List<Long>,val songs:List<StatisticsRank>,val artists:List<StatisticsRank>,val albums:List<StatisticsRank>)
@Immutable data class StatisticsInfo(val period:String="month",val offset:Int=0,val loading:Boolean=false,val warning:String="",val recording:Boolean=true)
private fun listeningTime(ms:Long):String = if(ms>=3600000)"${ms/3600000} h ${(ms/60000)%60} min" else if(ms>=60000)"${ms/60000} min" else "${ms/1000} s"

@Composable internal fun StatisticsPage(data:UiModel) {
    val info=data.statsInfo
    val report=data.statsReport
    var rank by remember {mutableStateOf("songs")}
    Column(Modifier.fillMaxSize()) {
        Box(Modifier.padding(start=12.dp,end=16.dp,top=10.dp,bottom=8.dp)) {ContentHeading("Listening report","statistics-refresh",info.loading)}
        LazyRow(contentPadding=PaddingValues(horizontal=24.dp),horizontalArrangement=Arrangement.spacedBy(8.dp)) {items(listOf("day" to "Day","week" to "Week","month" to "Month","year" to "Year","all" to "All")) {(key,label)->FilterChip(info.period==key,{command("statistics-period",key)},label={Text(label)})}}
        if(info.period!="all")Row(Modifier.fillMaxWidth().padding(horizontal=24.dp),verticalAlignment=Alignment.CenterVertically) {Action("back","Previous period",enabled=info.offset<120) {command("statistics-offset",(info.offset+1).toString())};Text(report?.label ?: "Preparing report",Modifier.weight(1f),style=MaterialTheme.typography.titleSmall);Action("next","Next period",enabled=info.offset>0) {command("statistics-offset",(info.offset-1).toString())}}
        LazyColumn(state=retainedContentScroll(data.viewKey),modifier=Modifier.fillMaxSize(),contentPadding=PaddingValues(start=24.dp,end=24.dp,top=12.dp,bottom=190.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
            if(info.warning.isNotEmpty())item {ErrorCard(info.warning) {command("statistics-refresh")}}
            if(info.loading && report==null)item {LoadingRows()}
            if(report!=null) {
                item {
                    val purple=if(data.dark)Color(0xFF322C49) else Color(0xFFEAE3FF)
                    Surface(shape=RoundedCornerShape(26.dp),color=purple) {Column(Modifier.fillMaxWidth().padding(22.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {Text(report.label,style=MaterialTheme.typography.labelLarge,color=MaterialTheme.colorScheme.onSurfaceVariant);Text("A soundtrack to your days",style=MaterialTheme.typography.titleLarge,fontWeight=FontWeight.Bold);Text(listeningTime(report.totalMs),style=MaterialTheme.typography.headlineLarge,fontWeight=FontWeight.Bold);Text("${report.songCount} tracks · ${report.artistCount} artists · ${report.plays} listens",style=MaterialTheme.typography.bodyMedium);StatisticsTrend(report.points,Color(0xFF9585E4));if(report.points.isNotEmpty())Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween) {Text(report.points.first().label,style=MaterialTheme.typography.labelSmall);Text(report.points.last().label,style=MaterialTheme.typography.labelSmall)}}}
                }
                item {Row(horizontalArrangement=Arrangement.spacedBy(12.dp)) {StatisticsMetric("Daily listening average",listeningTime(report.averageMs),if(data.dark)Color(0xFF243D42) else Color(0xFFD9F2F4),Modifier.weight(1f));StatisticsMetric("Days with music", "${report.days} days",if(data.dark)Color(0xFF44343D) else Color(0xFFFFE2ED),Modifier.weight(1f))}}
                item {Surface(shape=RoundedCornerShape(24.dp),color=MaterialTheme.colorScheme.surfaceContainer) {Row(Modifier.fillMaxWidth().padding(20.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(20.dp)) {Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(6.dp)) {Text("Listening hours",style=MaterialTheme.typography.titleMedium,fontWeight=FontWeight.SemiBold);Text("Based on actual playback in local time",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)};StatisticsHours(report.hours)}}}
                if(report.plays==0)item {EmptyState("Waiting for your next song","Recorded after 30 seconds of playback. Pausing, buffering, and seeking do not add listening time.","music")}
                if(report.plays>0) {
                    item {Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {for((key,label) in listOf("songs" to "Tracks","artists" to "Artists","albums" to "Albums"))FilterChip(rank==key,{rank=key},label={Text(label)})}}
                    val rows=when(rank){"artists"->report.artists;"albums"->report.albums;else->report.songs}
                    itemsIndexed(rows,key={_,row->"$rank|${row.key}"}) {index,row->
                        Surface(onClick={if(rank=="artists" && row.creatorId.isNotEmpty() && row.source!="local")command("creator-direct",payload("source" to row.source,"id" to row.creatorId))else if(rank!="artists")command("statistics-play",row.songId)},shape=RoundedCornerShape(18.dp),color=MaterialTheme.colorScheme.surfaceContainer) {Row(Modifier.fillMaxWidth().padding(12.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {Text("${index+1}",style=MaterialTheme.typography.labelLarge,color=MaterialTheme.colorScheme.primary,modifier=Modifier.width(22.dp));val coverId=if(rank=="artists" && row.creatorId.isNotEmpty() && row.source!="local")"creator-${row.source}-${row.creatorId}" else row.songId;Cover(Song(coverId,row.label,row.label,cover=true,source=row.source),48.dp);Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)) {Text(row.label,fontWeight=FontWeight.SemiBold,maxLines=1,overflow=TextOverflow.Ellipsis);Text("${listeningTime(row.totalMs)} · ${row.plays} plays",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}}}
                    }
                }
            }
            item {SettingCard("Record listening statistics","Stored in this browser and included in full backups. Keeps up to the most recent 10000 records.") {Switch(checked=info.recording,onCheckedChange={command("setting",payload("key" to "recordListening","value" to it.toString()))})}}
            item {TextButton(onClick={command("dialog","statistics-reset")}) {Text("Clear local listening statistics",color=MaterialTheme.colorScheme.error)}}
        }
    }
}
@Composable private fun StatisticsMetric(label:String,value:String,color:Color,modifier:Modifier) {Surface(shape=RoundedCornerShape(22.dp),color=color,modifier=modifier) {Column(Modifier.padding(18.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {Text(label,style=MaterialTheme.typography.labelLarge);Text(value,style=MaterialTheme.typography.titleLarge,fontWeight=FontWeight.Bold)}}}
@Composable private fun StatisticsTrend(points:List<StatisticsPoint>,color:Color) {
    Canvas(Modifier.fillMaxWidth().height(104.dp)) {val maximum=(points.maxOfOrNull {it.value} ?: 0).coerceAtLeast(1).toFloat();val step=size.width/points.size.coerceAtLeast(1);points.forEachIndexed {i,point->val h=(point.value/maximum*(size.height-10.dp.toPx())).coerceAtLeast(2.dp.toPx());drawRoundRect(Brush.verticalGradient(listOf(color,color.copy(alpha=.35f))),Offset(i*step+step*.15f,size.height-h),Size(step*.7f,h),androidx.compose.ui.geometry.CornerRadius(3.dp.toPx()))}}
}
@Composable private fun StatisticsHours(hours:List<Long>) {
    val color=MaterialTheme.colorScheme.primary
    Canvas(Modifier.size(108.dp)) {val maximum=(hours.maxOrNull() ?: 0).coerceAtLeast(1).toFloat();val c=center;val radius=size.minDimension*.42f;drawCircle(color.copy(alpha=.1f),radius,style=Stroke(10.dp.toPx()));hours.take(24).forEachIndexed {i,value->val angle=(i/24.0*2*PI-PI/2);val inner=radius*(.6f+.25f*(1-value/maximum));drawLine(color.copy(alpha=if(value>0).9f else .15f),Offset(c.x+cos(angle).toFloat()*inner,c.y+sin(angle).toFloat()*inner),Offset(c.x+cos(angle).toFloat()*radius,c.y+sin(angle).toFloat()*radius),5.dp.toPx(),StrokeCap.Round)}}
}
