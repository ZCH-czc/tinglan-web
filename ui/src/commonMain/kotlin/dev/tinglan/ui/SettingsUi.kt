package dev.tinglan.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import dev.tinglan.core.SettingEntry
import dev.tinglan.core.SettingsCatalog

@Composable internal fun SettingsIcon(icon:String) {
    Box(Modifier.size(38.dp).background(MaterialTheme.colorScheme.primary.copy(alpha=.08f),RoundedCornerShape(12.dp)),contentAlignment=Alignment.Center) {Glyph(icon,Modifier.size(24.dp),MaterialTheme.colorScheme.primary)}
}
@Composable internal fun SettingLink(title:String,summary:String,icon:String,enabled:Boolean=true,onClick:()->Unit) {
    FlatSelectableSurface(false,RoundedCornerShape(18.dp),MaterialTheme.colorScheme.surfaceContainerLow,enabled=enabled,onClick=onClick,modifier=Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().heightIn(min=78.dp).padding(horizontal=16.dp,vertical=14.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(14.dp)) {
            SettingsIcon(icon)
            Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(5.dp)) {Text(trMessage(title),fontWeight=FontWeight.SemiBold);Text(trMessage(summary),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
            Glyph("chevron",Modifier.size(18.dp),MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
@Composable private fun SettingToggle(entry:SettingEntry,value:Boolean) {
    Surface(color=MaterialTheme.colorScheme.surfaceContainerLow,shape=RoundedCornerShape(18.dp)) {
        Row(Modifier.fillMaxWidth().heightIn(min=84.dp).toggleable(value=value,role=Role.Switch,onValueChange={command("setting",payload("key" to if(entry.id=="motion")"reduceMotion" else "autoOpen","value" to it.toString()))}).padding(horizontal=16.dp,vertical=14.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(14.dp)) {
            SettingsIcon(entry.icon)
            Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(5.dp)) {Text(tr(entry.title),fontWeight=FontWeight.SemiBold);Text(tr(entry.summary),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
            Switch(checked=value,onCheckedChange=null)
        }
    }
}
@Composable internal fun SettingsPage(state:LazyListState,data:UiModel,filter:MutableState<TextFieldValue>) {
    val query=filter.value.text
    val entries=remember(query,uiLanguage) {SettingsCatalog.search(query,::chineseText)}
    val searchScroll=rememberLazyListState()
    LaunchedEffect(query) {if(query.isNotBlank())searchScroll.scrollToItem(0)}
    Column(Modifier.fillMaxSize().padding(horizontal=24.dp),horizontalAlignment=Alignment.CenterHorizontally) {
        TextField(filter.value,{filter.value=it.copy(text=it.text.take(200))},singleLine=true,placeholder={Text(tr("Search settings"))},leadingIcon={Glyph("search")},trailingIcon={if(query.isNotEmpty())Action("close",tr("Clear settings search")) {filter.value=TextFieldValue("")}},shape=RoundedCornerShape(18.dp),colors=TextFieldDefaults.colors(focusedIndicatorColor=androidx.compose.ui.graphics.Color.Transparent,unfocusedIndicatorColor=androidx.compose.ui.graphics.Color.Transparent,focusedContainerColor=MaterialTheme.colorScheme.surfaceContainer,unfocusedContainerColor=MaterialTheme.colorScheme.surfaceContainerLow),modifier=Modifier.widthIn(max=960.dp).fillMaxWidth().padding(top=8.dp,bottom=12.dp).guideTarget("settings-search").semantics {contentDescription=tr("Search settings")})
        LazyColumn(state=if(query.isBlank())state else searchScroll,modifier=Modifier.widthIn(max=960.dp).fillMaxWidth().weight(1f),contentPadding=PaddingValues(bottom=190.dp),verticalArrangement=Arrangement.spacedBy(10.dp)) {
            if(query.isNotBlank())item {Text(if(entries.isEmpty())tr("No matching settings") else tr("{0} settings", entries.size),style=MaterialTheme.typography.labelLarge,color=MaterialTheme.colorScheme.onSurfaceVariant)}
            if(entries.isEmpty())item {EmptyState(tr("Try another keyword"),tr("Try searching for“account”“Lyrics”“Backup”“Bluetooth”or“Cache”. "),"search")}
            var group=""
            entries.forEach {entry ->
                if(query.isBlank() && entry.group!=group){group=entry.group;item(key="group-$group") {Text(tr(entry.group),style=MaterialTheme.typography.titleSmall,color=MaterialTheme.colorScheme.onSurfaceVariant,modifier=Modifier.padding(start=4.dp,top=12.dp,bottom=2.dp))}}
                item(key=entry.id) {
                    when(entry.id){
                        "motion"->SettingToggle(entry,data.reduced)
                        "autoOpen"->SettingToggle(entry,data.autoOpen)
                        "volume"->Surface(shape=RoundedCornerShape(18.dp),color=MaterialTheme.colorScheme.surfaceContainerLow) {
                            Column(Modifier.fillMaxWidth().padding(16.dp)) {
                                Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(14.dp)) {SettingsIcon(entry.icon);Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)) {Text(tr(entry.title),fontWeight=FontWeight.SemiBold);Text(tr(entry.summary),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)};Text("${(data.volume*100).toInt()}%",style=MaterialTheme.typography.labelLarge)}
                                Slider(value=data.volume,onValueChange={command("volume",it.toString())},modifier=Modifier.fillMaxWidth().padding(top=6.dp).semantics {contentDescription=tr("Tinglan volume")})
                            }
                        }
                        else->{
                            val summary=when(entry.id){"language"->if(uiLanguage=="zh-CN")"简体中文"else "English · Default";"font"->when(data.font){"serif"->tr("Noto Serif SC");"wenkai"->tr("LXGW WenKai");"nunito"->tr("Nunito · Noto Sans SC for Chinese text");else->tr("Noto Sans SC · Default")};"motion-preset"->if(data.motionPreset=="slow")tr("Relaxed")else tr("Fast · Default");"lyrics-appearance"->tr("Current size {0}", data.lyricsSize);"theme"->when(data.theme){"dark"->tr("Dark · Always use dark appearance");"light"->tr("Light · Always use light appearance");else->tr("System · Follow device appearance")};"search"->tr("{0} first · Changes result order only", platformName(data.searchPreference));"about"->tr("Web 0.31.2 · Version and open-source licenses");else->entry.summary}
                            SettingLink(entry.title,summary,entry.icon) {command(entry.action,entry.value)}
                        }
                    }
                }
            }
            if(data.updateAvailable && query.isBlank())item {SettingLink(tr("Update ready"),tr("Save the current position before updating. Playback stays paused after reopening."),"update") {command("apply-update")}}
            if(query.isBlank())item {Text(tr("Settings stay in this browser. Music backups do not include platform sign-in details."),Modifier.padding(horizontal=4.dp,vertical=12.dp),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
        }
    }
}
