package dev.tinglan.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.*

@Immutable data class WebIntegrationInfo(val installed:Boolean=false,val canInstall:Boolean=false,val notice:Boolean=false,val notifications:String="unsupported",val notifyEnabled:Boolean=false,val backgroundFetch:Boolean=false,val mediaSession:Boolean=false)
private fun JsonObject.b(k:String)=this[k]?.jsonPrimitive?.booleanOrNull==true
private fun JsonObject.s(k:String,d:String)=this[k]?.jsonPrimitive?.contentOrNull?:d
internal fun webIntegrationInfo(o:JsonObject)=WebIntegrationInfo(o.b("installed"),o.b("canInstall"),o.b("notice"),o.s("notifications","unsupported"),o.b("notifyEnabled"),o.b("backgroundFetch"),o.b("mediaSession"))
@Composable internal fun InstallSuggestion() {
    if(!model.webIntegration.notice || model.webIntegration.installed)return
    Surface(Modifier.padding(horizontal=24.dp,vertical=6.dp).fillMaxWidth(),shape=RoundedCornerShape(20.dp),color=MaterialTheme.colorScheme.secondaryContainer) {
        Row(Modifier.padding(start=16.dp,end=4.dp,top=5.dp,bottom=5.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(10.dp)) {
            Glyph("install",color=MaterialTheme.colorScheme.onSecondaryContainer)
            Column(Modifier.weight(1f)){Text("Add Tinglan to your device",fontWeight=FontWeight.SemiBold);Text("Your own window · Offline listening",style=MaterialTheme.typography.bodySmall)}
            TextButton(onClick={command("pwa-install")}){Text("Install")}
            Action("close","Remind me later"){command("pwa-later")}
        }
    }
}
@Composable internal fun WebIntegrationDialog() {
    val info=model.webIntegration
    TinglanAlertDialog(onDismissRequest={command("dialog-close")},bottomSheet=true,title={Text("Install & notifications")},text={
        Column(Modifier.verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(12.dp)) {
            SettingLink(if(info.installed)"Installed on this device" else "Install Tinglan",if(info.canInstall)"Open the browser’s install prompt" else if(info.installed)"Use a standalone window and offline app resources" else "In your browser menu, choose“Install app”or“Add to Home Screen”","install",!info.installed){command("pwa-install")}
            SettingLink("Download notifications",when(info.notifications){"unsupported"->"System notifications are unavailable in this browser";"denied"->"Notifications are blocked. Allow them in site permissions";else->if(info.notifyEnabled)"Enabled · Uses your device’s notification center" else "With permission, notify when downloads finish or fail"},"bell",info.notifications!="unsupported"){command(if(info.notifyEnabled)"notifications-disable" else "notifications-enable")}
            Text("${if(info.mediaSession)"System media controls can show the track, artwork, and playback actions." else "System media controls are unavailable in this browser."} Appearance is controlled by your system and browser.",style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
            Text(if(info.backgroundFetch)"This browser supports persistent background downloads. Approved downloads can continue after closing the page while the companion stays running." else "Downloads use a background worker. Keep this page open because persistent background downloading is unavailable. Interrupted tasks can be retried.",style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
        }
    },confirmButton={TextButton(onClick={command("dialog-close")}){Text("Done")}})
}
