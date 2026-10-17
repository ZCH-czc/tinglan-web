package dev.tinglan.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

@Composable internal fun LanTransferPage(data:UiModel) {
    val info=model.transfer
    var selected by remember {mutableStateOf("")}
    LaunchedEffect(info.addresses) {if(info.addresses.none {it.address==selected})selected=info.addresses.firstOrNull()?.address.orEmpty()}
    Column(Modifier.fillMaxSize()) {
        Box(Modifier.padding(start=12.dp,end=16.dp,top=10.dp,bottom=8.dp)) {ContentHeading("LAN music transfer","transfer-refresh",info.busy)}
        LazyColumn(state=retainedContentScroll(data.viewKey),modifier=Modifier.fillMaxSize(),contentPadding=PaddingValues(start=24.dp,end=24.dp,bottom=190.dp),verticalArrangement=Arrangement.spacedBy(14.dp)) {
            item {Text("Scan with another device to send local music here. Both devices must use the same Wi-Fi or wired local network.",color=MaterialTheme.colorScheme.onSurfaceVariant)}
            if(!info.active) {
                item {Text("Receiving network",style=MaterialTheme.typography.titleMedium,fontWeight=FontWeight.SemiBold)}
                info.addresses.forEach {address->item(key=address.address) {Surface(onClick={selected=address.address},shape=RoundedCornerShape(16.dp),color=if(selected==address.address)MaterialTheme.colorScheme.primary.copy(alpha=.12f)else MaterialTheme.colorScheme.surfaceContainer) {Row(Modifier.fillMaxWidth().padding(16.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {Glyph(if(selected==address.address)"check" else "music");Column {Text(address.name);Text(address.address,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}}}}}
                if(info.loaded && info.addresses.isEmpty())item {Text("No local IPv4 address available. Connect to Wi-Fi or a wired network, then refresh.",color=MaterialTheme.colorScheme.onSurfaceVariant)}
                item {Button(onClick={command("transfer-start",selected)},enabled=info.loaded && !info.busy && !info.needsStop && selected.isNotBlank(),shape=RoundedCornerShape(14.dp),modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)) {Text("Start receiving")}}
            }else {
                item {Column(Modifier.fillMaxWidth(),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(12.dp)) {Box(Modifier.size(224.dp)) {LoginSymbol(model.transferQrRows,"Music transfer QR code; scan with the sending device")};Text("QR code 10 minutes remaining",color=MaterialTheme.colorScheme.onSurfaceVariant);TextButton(onClick={command("transfer-copy")}) {Text("Copy receiver address")}}}
            }
            if(info.active || info.needsStop)item {OutlinedButton(onClick={command("transfer-stop")},enabled=!info.busy,modifier=Modifier.fillMaxWidth()) {Text("Stop receiving")}}
            if(info.busy)item {Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {CircularProgressIndicator(Modifier.size(20.dp),strokeWidth=2.dp);Text("Updating receiver status…")}}
            if(info.receiving)item {Text("Receiving · ${info.filename}");LinearProgressIndicator(progress={info.progress.coerceIn(0f,1f)},modifier=Modifier.fillMaxWidth())}
            if(info.importing.isNotBlank())item {Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {CircularProgressIndicator(Modifier.size(18.dp),strokeWidth=2.dp);Text("Importing · ${info.importing}")}}
            if(info.warning.isNotBlank())item {Text(info.warning,color=MaterialTheme.colorScheme.error,style=MaterialTheme.typography.bodyMedium)}
            if(info.notice.isNotBlank())item {Text(info.notice,color=MaterialTheme.colorScheme.primary)}
            model.transferReceipts.forEach {receipt->item(key=receipt.id) {Surface(shape=RoundedCornerShape(16.dp),color=MaterialTheme.colorScheme.surfaceContainer) {Row(Modifier.fillMaxWidth().padding(16.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {Glyph(if(receipt.status=="imported")"check" else "music");Column(Modifier.weight(1f)) {Text(receipt.name,maxLines=2);Text(when(receipt.status){"imported"->"Added to local music";"failed"->receipt.error.ifBlank {"Import incomplete"};else->"Waiting to import"},style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)};if(receipt.status=="failed")TextButton(onClick={command("transfer-retry",receipt.id)},enabled=info.importing.isEmpty()) {Text("Retry")}}}}}
            item {Text("Per track up to 512 MB, Per batch up to 20 tracks, 1 GB. The temporary receiver stays open only while this page is visible. Leaving or hiding it stops receiving. Use a trusted network. Original audio, tags, embedded lyrics, and artwork are saved.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
        }
    }
}

@Composable internal fun LanSenderPage() {
    val info=model.transferSender
    LazyColumn(Modifier.fillMaxSize().widthIn(max=640.dp),contentPadding=PaddingValues(24.dp),verticalArrangement=Arrangement.spacedBy(18.dp),horizontalAlignment=Alignment.CenterHorizontally) {
        item {Row(Modifier.fillMaxWidth().padding(top=18.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {Glyph("brand",Modifier.size(34.dp),MaterialTheme.colorScheme.primary);Text("Bring your music to Tinglan",style=MaterialTheme.typography.headlineSmall,fontWeight=FontWeight.Bold)}}
        item {Text("Choose music on this device and send it to the device showing the code. Keep the receiver page visible.",color=MaterialTheme.colorScheme.onSurfaceVariant)}
        item {Button(onClick={command("transfer-pick")},enabled=!info.busy,modifier=Modifier.fillMaxWidth().heightIn(min=50.dp),shape=RoundedCornerShape(16.dp)) {Glyph("folder",color=MaterialTheme.colorScheme.onPrimary);Spacer(Modifier.width(10.dp));Text("Choose local music")}}
        info.files.forEachIndexed {index,file->item(key=index) {Surface(shape=RoundedCornerShape(16.dp),color=MaterialTheme.colorScheme.surfaceContainer) {Column(Modifier.fillMaxWidth().padding(16.dp),verticalArrangement=Arrangement.spacedBy(4.dp)) {Text(file.name,maxLines=2);Text("${file.megabytes} MB",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}}}}
        if(info.busy) {
            item {Text("${info.completed}/${info.total} · ${info.filename}");LinearProgressIndicator(progress={info.progress.coerceIn(0f,1f)},modifier=Modifier.fillMaxWidth())}
            item {OutlinedButton(onClick={command("transfer-cancel")},modifier=Modifier.fillMaxWidth()) {Text("Cancel transfer")}}
        }else item {Button(onClick={command("transfer-send")},enabled=info.files.isNotEmpty(),modifier=Modifier.fillMaxWidth().heightIn(min=50.dp),shape=RoundedCornerShape(16.dp)) {Text("Send ${info.files.size} tracks")}}
        if(info.error.isNotBlank())item {Text(info.error,color=MaterialTheme.colorScheme.error)}
        if(info.notice.isNotBlank())item {Text(info.notice,color=MaterialTheme.colorScheme.primary)}
        item {Text("Supports MP3, M4A, AAC, FLAC, WAV, Ogg, Opus, AIFF, APE and WMA. Per track no larger than 512 MB, Per batch up to 20 tracks. Files are transferred, then checked and imported by the receiver.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
    }
}
