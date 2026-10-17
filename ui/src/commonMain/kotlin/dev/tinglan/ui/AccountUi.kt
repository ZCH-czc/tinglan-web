package dev.tinglan.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.*
import dev.tinglan.core.accountPresentation
import androidx.compose.foundation.lazy.*
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import kotlin.math.floor
import kotlin.math.min

private val accountSources=listOf("qq","bili","netease")
private fun platformSummary(id:String)=when(id){"qq"->"Search music, playlists, and comments. Playback follows your account access.";"bili"->"Music, videos, your following feed, likes, and video collections.";else->"Search music, playlists, artists, and comments with your account access."}
private fun scanInstruction(id:String)=if(id=="qq")"Use the mobile QQ app to scan, then authorize QQ Music on the official page." else "Use ${platformName(id)} the official app to scan and confirm sign-in."
@Composable private fun PlatformMark(id:String,size:Int=46){Box(Modifier.size(size.dp).background(sourceColor(id).copy(alpha=.12f),RoundedCornerShape((size*.30f).dp)),contentAlignment=Alignment.Center){Glyph(id,Modifier.size((size*.56f).dp),sourceColor(id))}}
@Composable private fun AccountStatus(id:String){
    val account=model.accounts.find {it.source==id}
    val status=accountPresentation(model.accountLoaded,account?.connected==true,account?.status.orEmpty(),model.accountChecking==id)
    Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(7.dp),modifier=Modifier.semantics {liveRegion=LiveRegionMode.Polite}){
        if(model.accountChecking==id)CircularProgressIndicator(Modifier.size(16.dp),strokeWidth=2.dp)else Glyph(status.icon,Modifier.size(17.dp),if(status.attention)MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary)
        Text(status.title,style=MaterialTheme.typography.labelLarge,color=if(status.attention)MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary)
    }
}
@Composable private fun PlatformAccountCard(id:String,modifier:Modifier=Modifier,wide:Boolean=false){
    val account=model.accounts.find {it.source==id}
    FlatSelectableSurface(false,RoundedCornerShape(22.dp),MaterialTheme.colorScheme.surfaceContainerLow,modifier=modifier,onClick={command("accounts-select",id)}){
        Column(Modifier.fillMaxWidth().heightIn(min=if(wide)228.dp else 164.dp).padding(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
            Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)){PlatformMark(id);Text(platformName(id),Modifier.weight(1f),fontWeight=FontWeight.SemiBold,style=MaterialTheme.typography.titleMedium);Glyph("chevron",Modifier.size(18.dp),MaterialTheme.colorScheme.onSurfaceVariant)}
            Text(platformSummary(id),modifier=Modifier.heightIn(min=if(wide)40.dp else 0.dp),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            if(wide || !account?.name.isNullOrBlank())Text(account?.name.orEmpty(),maxLines=1,overflow=TextOverflow.Ellipsis,style=MaterialTheme.typography.bodyMedium)
            AccountStatus(id)
        }
    }
}
@Composable internal fun AccountsPage(data:UiModel,state:LazyListState){
    val id=data.accountSource
    Box(Modifier.fillMaxSize(),contentAlignment=Alignment.TopCenter){
        LazyColumn(state=state,modifier=Modifier.widthIn(max=1000.dp).fillMaxSize(),contentPadding=PaddingValues(start=24.dp,end=24.dp,top=12.dp,bottom=190.dp),verticalArrangement=Arrangement.spacedBy(18.dp)){
            item {Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Action("back","Back"){command("page-back")};Text(if(id.isEmpty())"Accounts & platforms" else platformName(id),Modifier.weight(1f),fontWeight=FontWeight.Bold,style=MaterialTheme.typography.titleLarge);Action("help","Sign-in help"){command("dialog","accounts-help")};Action("refresh","Refresh account status",enabled=!model.accountLoading && !model.accountChanging && model.accountChecking.isEmpty()){command("accounts-refresh")}}}
            if(model.accountLoading)item {LinearProgressIndicator(Modifier.fillMaxWidth());Text("Checking account status…",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
            if(model.accountError.isNotBlank())item {ErrorCard(model.accountError){command("accounts-refresh")}}
            if(id.isEmpty()){
                item {Text("Connect your own platform accounts to access their content. Signing in does not change your local music or playlists.",color=MaterialTheme.colorScheme.onSurfaceVariant,style=MaterialTheme.typography.bodyMedium)}
                item {BoxWithConstraints(Modifier.fillMaxWidth()) {if(maxWidth>=850.dp)Row(horizontalArrangement=Arrangement.spacedBy(16.dp)){accountSources.forEach {source->PlatformAccountCard(source,Modifier.weight(1f),true)}}else Column(verticalArrangement=Arrangement.spacedBy(12.dp)){accountSources.forEach {source->PlatformAccountCard(source,Modifier.fillMaxWidth())}}}}
            }else if(id in accountSources){
                item {AccountDetail(id)}
            }
            item {Row(horizontalArrangement=Arrangement.spacedBy(10.dp),verticalAlignment=Alignment.Top){Glyph("shield",Modifier.size(18.dp),MaterialTheme.colorScheme.onSurfaceVariant);Text("Account sessions stay in the local companion on this device and are excluded from backups. Sign in again after restarting the service; Web and Android do not automatically share sign-in details.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}}
        }
    }
}
@Composable private fun AccountDetail(id:String){
    val account=model.accounts.find {it.source==id}
    val status=accountPresentation(model.accountLoaded,account?.connected==true,account?.status.orEmpty(),model.accountChecking==id)
    val enabled=!model.accountChanging && !model.accountLoading && model.accountChecking.isEmpty()
    var advanced by remember(id){mutableStateOf(false)}
    Column(verticalArrangement=Arrangement.spacedBy(18.dp)){
        Surface(shape=RoundedCornerShape(22.dp),color=MaterialTheme.colorScheme.surfaceContainerLow){
            Column(Modifier.fillMaxWidth().padding(20.dp),verticalArrangement=Arrangement.spacedBy(14.dp)){
                Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(14.dp)){PlatformMark(id,54);Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(6.dp)){Text(account?.name?.takeIf {it.isNotBlank()} ?: platformName(id),style=MaterialTheme.typography.titleLarge,fontWeight=FontWeight.SemiBold);AccountStatus(id)}}
                Text(status.detail,style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
                if(id!="netease"){
                    Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)){Glyph("refresh",Modifier.size(18.dp),MaterialTheme.colorScheme.primary);Text(if(account?.automaticRenewal==true)when(account.renewalStatus){"checking"->"Checking session renewal";"rejected"->"Sign in again to renew";"deferred"->"Session renewal paused";"unavailable"->"Session renewal will retry later";"refreshed"->"Session renewed";else->"Automatic renewal enabled"}else if(account?.connected==true)"Renewal credentials missing" else "QR sign-in supports automatic renewal",style=MaterialTheme.typography.bodyMedium)}
                    Text(if(account?.automaticRenewal==true)"Checks periodically and attempts renewal when the session expires. Network failures preserve the session." else "Scan a new QR code in Tinglan to obtain renewal credentials. Importing only Cookie usually does not enable renewal.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                    if(account?.renewalError?.isNotBlank()==true)Text(account.renewalError,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if(account?.error?.isNotBlank()==true)Text(account.error,color=MaterialTheme.colorScheme.error,style=MaterialTheme.typography.bodySmall)
                if(account?.connected==true)Row(horizontalArrangement=Arrangement.spacedBy(10.dp)){
                    OutlinedButton(onClick={command("account-check",id)},enabled=enabled){Text("Check status")}
                    TextButton(onClick={command("account-disconnect-open",id)},enabled=enabled){Text("Sign out",color=MaterialTheme.colorScheme.error)}
                }
            }
        }
        Text(if(account?.connected==true)"Sign in again" else "Sign in with QR code",fontWeight=FontWeight.SemiBold,style=MaterialTheme.typography.titleMedium)
        Text(scanInstruction(id),color=MaterialTheme.colorScheme.onSurfaceVariant,style=MaterialTheme.typography.bodyMedium)
        Button(onClick={command("account-start",id)},enabled=enabled,modifier=Modifier.fillMaxWidth().heightIn(min=50.dp),shape=RoundedCornerShape(16.dp)){Glyph("qr",Modifier.size(21.dp),MaterialTheme.colorScheme.onPrimary);Spacer(Modifier.width(10.dp));Text(if(id=="qq")"Get QQ sign-in QR code" else "Get ${platformName(id)} sign-in QR code")}
        Text("Scan this code with the official app on another device. Confirm each sign-in in that app.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        TextButton(onClick={advanced=!advanced},enabled=enabled){Text(if(advanced)"Hide other methods" else "Other sign-in methods");Spacer(Modifier.width(8.dp));Glyph(if(advanced)"up" else "down",Modifier.size(16.dp))}
        if(advanced){
            SettingLink("Import your Cookie","You can import an existing browser session. Check its status after importing.","key",enabled){command("account-open",id)}
            Text(if(id=="qq")"Web Currently supports mobile QQ QR sign-in and Cookie import. Phone number, WeChat, and Android app-to-app sign-in are not supported yet." else "Web Currently supports official-app QR sign-in and Cookie import. Accounts in installed apps are not read directly.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
@Composable internal fun AccountUtilityDialog(){
    val kind=model.dialog;val source=model.target
    var text by remember(kind,source){mutableStateOf(TextFieldValue(""))}
    var reveal by remember(kind,source){mutableStateOf(false)}
    val close={command("dialog-close")}
    val title=when(kind){"account-connect"->"Import ${platformName(source)} session";"account-disconnect"->"Sign out ${platformName(source)}？";"settings-local"->"Import local music";else->"Platform sign-in help"}
    TinglanAlertDialog(onDismissRequest=close,title={Text(title)},text={Column(Modifier.fillMaxWidth().heightIn(max=500.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(14.dp)){
        when(kind){
            "account-connect"->{
                Text("Paste only your own account's Cookie. The session is used only by this local companion and is excluded from music backups.",style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
                TextField(text,{if(it.text.length<=12000)text=it},label={Text("Your own account Cookie")},modifier=Modifier.fillMaxWidth().heightIn(min=140.dp,max=260.dp),visualTransformation=if(reveal)VisualTransformation.None else PasswordVisualTransformation(),shape=RoundedCornerShape(16.dp))
                Row(verticalAlignment=Alignment.CenterVertically){Checkbox(checked=reveal,onCheckedChange={reveal=it});Text("Show session contents",style=MaterialTheme.typography.bodySmall)}
                Text("Verify the account after saving. Access is determined by the platform.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            }
            "account-disconnect"->Text("Disconnect this account from the local companion. Local music, playlists, and notes are kept. Sign in again to access account content.")
            "settings-local"->{Text("Choose audio files or a folder. Tinglan reads their metadata and saves them in this browser.",color=MaterialTheme.colorScheme.onSurfaceVariant);SettingLink("Choose audio files","Supports MP3, FLAC, M4A, WAV and other formats.","music"){command("settings-import","files")};SettingLink("Choose music folder","Import audio from the folder and its subfolders.","folder"){command("settings-import","folder")};Text("If your browser can access a U drive, import it with the file picker. This does not continuously scan storage like Android does.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
            else->{accountSources.forEach {id->Row(horizontalArrangement=Arrangement.spacedBy(12.dp)){PlatformMark(id,36);Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)){Text(platformName(id),fontWeight=FontWeight.SemiBold);Text(scanInstruction(id),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}}};Text("Public search works without signing in. QR sign-in, playback, quality, and interactions depend on platform availability and account access.",style=MaterialTheme.typography.bodySmall);Text("A failed check does not sign you out. Network failures preserve the session; sign-in is requested only after confirmed expiry.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
        }
    }},confirmButton={when(kind){"account-connect"->TextButton(onClick={command("dialog-save",text.text)},enabled=text.text.isNotBlank() && !model.accountChanging){Text(if(model.accountChanging)"Connecting…" else "Save session")};"account-disconnect"->TextButton(onClick={command("account-clear",source)},enabled=!model.accountChanging){Text("Sign out",color=MaterialTheme.colorScheme.error)};else->TextButton(onClick=close){Text("Done")}}},dismissButton={if(kind in listOf("account-connect","account-disconnect"))TextButton(onClick=close){Text("Cancel")}})
}

@Composable internal fun LoginSymbol(rows:List<String>,label:String="sign-in code; scan with the official app") {
    // Cache geometry. Module pixels stay crisp; a four-module white quiet zone surrounds the symbol.
    val path=remember(rows) {Path().apply {rows.forEachIndexed {y,row->row.forEachIndexed {x,b->if(b=='1')addRect(androidx.compose.ui.geometry.Rect(x.toFloat(),y.toFloat(),x+1f,y+1f))}}}}
    Canvas(Modifier.fillMaxSize().semantics {contentDescription=label}) {
        drawRect(Color.White)
        val count=rows.size+8;val unit=floor(min(size.width,size.height)/count).coerceAtLeast(1f)
        withTransform({translate((size.width-count*unit)/2+4*unit,(size.height-count*unit)/2+4*unit);scale(unit,unit,Offset.Zero)}) {drawPath(path,Color.Black)}
    }
}

@Composable internal fun AccountQrDialog() {
    val login=model.login
    val pending=login.status in listOf("creating","waiting","scanned")
    val bitmap=remember(login.imageKey,artRevision) {artworkFor(login.imageKey)}
    val label=when(login.status){"creating"->"Preparing QR code…";"waiting"->"Scan to sign in";"scanned"->"Scanned. Confirm in the official app";"authorized"->"Authorized";"expired"->"QR code expired";"refused"->"Authorization cancelled";"error"->"Sign-in incomplete";else->"Preparing QR sign-in"}
    TinglanAlertDialog(onDismissRequest={command("account-back")},shape=RoundedCornerShape(26.dp),title={Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)){PlatformMark(login.source,36);Text("${platformName(login.source)} Sign in")}},text={
        Column(Modifier.fillMaxWidth().heightIn(max=520.dp).verticalScroll(rememberScrollState()),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(14.dp)) {
            Box(Modifier.size(224.dp).background(if(pending)Color.White else MaterialTheme.colorScheme.surfaceContainer,RoundedCornerShape(16.dp)),contentAlignment=Alignment.Center) {
                when {
                    login.status=="creating"->CircularProgressIndicator(Modifier.size(28.dp),color=Color(0xFF126A7A),strokeWidth=2.dp)
                    model.qrRows.isNotEmpty() && pending->LoginSymbol(model.qrRows)
                    bitmap!=null && pending->Image(bitmap,"Official sign-in QR code",Modifier.fillMaxSize().padding(8.dp),contentScale=ContentScale.Fit,filterQuality=FilterQuality.None)
                    else->Glyph(if(login.status=="authorized")"check" else "refresh",Modifier.size(40.dp),MaterialTheme.colorScheme.primary)
                }
            }
            Text(label,style=MaterialTheme.typography.titleMedium,fontWeight=FontWeight.Bold,modifier=Modifier.semantics {liveRegion=LiveRegionMode.Polite})
            if(login.error.isNotBlank())Text(login.error,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.error)
            if(login.status in listOf("waiting","scanned"))Text("${login.remaining} seconds until expiry",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            Text(scanInstruction(login.source),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            if(pending)Text("Keep this window open while authorizing. Closing it requires a new code.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        }
    },confirmButton={TextButton(onClick={command("account-back")}) {Text(if(login.status=="authorized")"Back to accounts" else "Cancel")}},dismissButton={if(login.status!="creating" && login.status!="authorized")TextButton(onClick={command("account-refresh")}) {Text("New QR code")}})
}
