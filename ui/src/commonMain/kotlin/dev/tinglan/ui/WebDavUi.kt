package dev.tinglan.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp

@Composable internal fun WebDavPage(data:UiModel) {
    // Connection data comes from the current owner, never a retained page model.
    val info=model.webdav
    var endpoint by remember {mutableStateOf("")};var username by remember {mutableStateOf("")};var password by remember {mutableStateOf("")};var deviceName by remember {mutableStateOf("Tinglan Web")}
    LaunchedEffect(info.configRevision) {if(info.loaded){endpoint=info.endpoint;username=info.username;deviceName=info.deviceName;password=""}}
    val enabled=info.loaded && !info.busy
    Column(Modifier.fillMaxSize()) {
        Box(Modifier.padding(start=12.dp,end=16.dp,top=10.dp,bottom=8.dp)) {ContentHeading("WebDAV Playback handoff","webdav-refresh",info.busy)}
        LazyColumn(state=retainedContentScroll(data.viewKey),modifier=Modifier.fillMaxSize(),contentPadding=PaddingValues(start=24.dp,end=24.dp,bottom=190.dp),verticalArrangement=Arrangement.spacedBy(14.dp)) {
            item {Text("Connect to the same WebDAV folder to save playback position and up to 40 platform tracks in Tinglan/playback.json. Refresh on another device to continue.",color=MaterialTheme.colorScheme.onSurfaceVariant,style=MaterialTheme.typography.bodyMedium)}
            if(!info.loaded && info.busy)item {LoadingRows()}
            item {TextField(endpoint,{endpoint=it.take(2048)},label={Text("HTTPS WebDAV Folder URL")},singleLine=true,enabled=enabled,modifier=Modifier.fillMaxWidth(),shape=RoundedCornerShape(14.dp))}
            item {TextField(username,{username=it.take(512)},label={Text("Username")},singleLine=true,enabled=enabled,modifier=Modifier.fillMaxWidth(),shape=RoundedCornerShape(14.dp))}
            item {TextField(password,{password=it.take(2048)},label={Text("Password / App-specific password")},singleLine=true,enabled=enabled,visualTransformation=PasswordVisualTransformation(),modifier=Modifier.fillMaxWidth(),shape=RoundedCornerShape(14.dp))}
            item {TextField(deviceName,{deviceName=it.take(100)},label={Text("This device's name")},singleLine=true,enabled=enabled,modifier=Modifier.fillMaxWidth(),shape=RoundedCornerShape(14.dp))}
            item {Button(onClick={command("webdav-connect",payload("endpoint" to endpoint.trim(),"username" to username,"password" to password,"deviceName" to deviceName.trim()))},enabled=enabled && endpoint.isNotBlank() && deviceName.isNotBlank(),shape=RoundedCornerShape(14.dp),modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)) {Text("Save and test connection")}}
            if(info.busy)item {Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {CircularProgressIndicator(Modifier.size(20.dp),strokeWidth=2.dp);Text("Processing handoff…",color=MaterialTheme.colorScheme.onSurfaceVariant)}}
            if(info.warning.isNotBlank())item {ErrorCard(info.warning) {command("webdav-refresh")}}
            if(info.notice.isNotBlank())item {Text(info.notice,color=MaterialTheme.colorScheme.primary,style=MaterialTheme.typography.bodyMedium)}
            if(info.connected) {
                item {Text("Current connection: ${info.endpoint}",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant);Row(horizontalArrangement=Arrangement.spacedBy(10.dp)) {OutlinedButton(onClick={command("webdav-refresh")},enabled=enabled) {Text("Refresh handoff")};TextButton(onClick={command("webdav-forget")},enabled=enabled) {Text("Disconnect")}}}
                item {Button(onClick={command("webdav-publish")},enabled=enabled && info.canSend && !info.needsRefresh,shape=RoundedCornerShape(14.dp),modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)) {Glyph("next",color=MaterialTheme.colorScheme.onPrimary);Spacer(Modifier.width(8.dp));Text("Send playback and pause")};if(!info.canSend)Text("Choose a platform track or video first. Local audio files and live streams cannot be transferred by this record.",Modifier.padding(top=8.dp),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
                if(info.remoteTitle.isNotBlank())item {
                    Surface(shape=RoundedCornerShape(20.dp),color=MaterialTheme.colorScheme.surfaceContainer) {
                        Column(Modifier.fillMaxWidth().padding(20.dp),verticalArrangement=Arrangement.spacedBy(10.dp)) {
                            Text(info.remoteTitle,style=MaterialTheme.typography.titleMedium,fontWeight=FontWeight.SemiBold)
                            Text(info.remoteArtist,color=MaterialTheme.colorScheme.onSurfaceVariant)
                            Text("${info.remoteDevice} · ${timestamp(info.remotePosition)} · ${info.remoteCount} tracks",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                            if(info.remoteExpired)Text("This handoff expired. Send it again from the source device",color=MaterialTheme.colorScheme.error)
                            if(info.incomingIssue.isNotBlank())Text(info.incomingIssue,color=MaterialTheme.colorScheme.error,style=MaterialTheme.typography.bodySmall)
                            Button(onClick={command("webdav-claim")},enabled=enabled && info.canReceive && !info.remoteExpired,shape=RoundedCornerShape(14.dp),modifier=Modifier.fillMaxWidth()) {Text("Continue here")}
                        }
                    }
                }else if(!info.busy)item {Text("No handoff in this folder yet. Send your current playback to begin.",color=MaterialTheme.colorScheme.onSurfaceVariant)}
                if(info.pendingResume)item {OutlinedButton(onClick={command("webdav-resume")},enabled=enabled,modifier=Modifier.fillMaxWidth()) {Text("Start received playback")}}
                item {TextButton(onClick={command("dialog","accounts")}) {Text("Manage platform accounts")}}
            }
            item {Text("Handoffs contain track details, queue, and position only. The target device needs its own platform access. Passwords stay in the local companion session; reconnect after restarting it.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
        }
    }
}
