package dev.tinglan.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

internal fun lyricsSourceLabel(song:Song)=when(song.lyricsSource){"kugou"->"Kugou lyrics";"local"->"Local lyrics";"bili"->"Bilibili Subtitles";"qq"->"QQ Music lyrics";"netease"->"NetEase lyrics";else->"Lyrics source"}
@Composable internal fun LyricsSourceButton(song:Song) {
    TextButton(onClick={command("lyric-source")},modifier=Modifier.semantics {contentDescription="Choose lyrics source: ${lyricsSourceLabel(song)}"}){Text(lyricsSourceLabel(song),style=MaterialTheme.typography.labelLarge)}
}

@Composable internal fun LyricsSourceDialog() {
    val info=model.lyricSource
    var title by remember(info.id) {mutableStateOf(info.title)}
    var artist by remember(info.id) {mutableStateOf(info.artist)}
    TinglanAlertDialog(onDismissRequest={command("dialog-close")},title={Text("Lyrics source")},text={
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(12.dp)) {
            Text("Current: ${model.current?.let(::lyricsSourceLabel) ?: "No lyrics available"}",style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
            listOf("platform" to "Platform lyrics / Subtitles","kugou" to "Kugou lyrics").forEach {(id,label)->
                SelectionRow(label,info.provider==id,description=if(info.loading && info.provider==id)"Matching…"else "",icon=if(id=="kugou")"lyrics"else model.current?.source?.takeIf {it in listOf("qq","bili","netease")} ?: "music") {command("lyrics-source",id)}
            }
            if(info.provider=="kugou") {
                Text(if(info.adjusted)"The song title was extracted from the video title. If no match is found, edit the title and artist below."else "Matches by title, artist, and recording duration. Existing lyrics are kept if no match is found.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                OutlinedTextField(title,{title=it},label={Text("Title")},singleLine=true,modifier=Modifier.fillMaxWidth(),shape=RoundedCornerShape(14.dp))
                OutlinedTextField(artist,{artist=it},label={Text("Artist")},singleLine=true,modifier=Modifier.fillMaxWidth(),shape=RoundedCornerShape(14.dp))
                if(info.duration>0)Text("Recording duration ${timestamp(info.duration)}",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                FilledTonalButton(onClick={command("lyrics-source-match",payload("id" to info.id,"title" to title,"artist" to artist))},enabled=!info.loading && title.isNotBlank() && artist.isNotBlank(),modifier=Modifier.fillMaxWidth()) {Text(if(info.loading)"Matching…"else "Match these details")}
            }
            if(info.error.isNotEmpty())Text(info.error,Modifier.semantics {liveRegion=LiveRegionMode.Polite},style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.error)
            if(info.notice.isNotEmpty())Text(info.notice,Modifier.semantics {liveRegion=LiveRegionMode.Polite},style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.primary)
            TextButton(onClick={command("lyrics-edit",model.current?.id.orEmpty())}){Text("Edit / Copy / Export local lyrics")}
        }
    },confirmButton={TextButton(onClick={command("dialog-close")}){Text("Done")}})
}
