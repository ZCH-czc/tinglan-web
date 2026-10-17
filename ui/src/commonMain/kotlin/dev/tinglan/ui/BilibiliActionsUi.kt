package dev.tinglan.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/** Platform interactions are separate from the local library's heart and playlist controls. */
@Composable internal fun BilibiliActionsDialog() {
    val info=model.biliActions
    val usable=info.loaded && !info.loading && !info.busy && !info.needsRefresh
    val changed=model.biliActionFolders.any {it.checked!=it.selected}
    TinglanAlertDialog(onDismissRequest={command("dialog-close")},shape=RoundedCornerShape(26.dp),title={
        Row(verticalAlignment=Alignment.CenterVertically) {
            Text("Bilibili Video actions",Modifier.weight(1f),style=MaterialTheme.typography.titleLarge)
            IconButton(onClick={command("bili-actions-refresh")},enabled=!info.loading && !info.busy,modifier=Modifier.semantics {contentDescription="Refresh likes and collections"}) {Glyph("refresh")}
        }
    },text={
        LazyColumn(Modifier.fillMaxWidth().heightIn(max=420.dp),verticalArrangement=Arrangement.spacedBy(10.dp)) {
            item {
                if(info.title.isNotBlank())Text(info.title,maxLines=2,overflow=TextOverflow.Ellipsis,fontWeight=FontWeight.SemiBold)
                Text("Changes sync to your Bilibili account. Tinglan favorites and playlists are managed separately.",Modifier.padding(top=7.dp),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if(info.loading)item {Row(Modifier.fillMaxWidth().padding(vertical=14.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {CircularProgressIndicator(Modifier.size(22.dp),strokeWidth=2.dp);Text("Loading likes and collections")}}
            if(info.warning.isNotBlank())item {Surface(shape=RoundedCornerShape(14.dp),color=MaterialTheme.colorScheme.errorContainer.copy(alpha=.6f)) {Text(info.warning,Modifier.padding(12.dp),color=MaterialTheme.colorScheme.onErrorContainer,style=MaterialTheme.typography.bodySmall)}}
            if(info.needsLogin)item {TextButton(onClick={command("bili-actions-account")},modifier=Modifier.fillMaxWidth()) {Glyph("bili",color=sourceColor("bili"));Spacer(Modifier.width(10.dp));Text("Connect Bilibili account")}}
            if(info.loaded) {
                item {
                    OutlinedButton(onClick={command("bili-actions-like")},enabled=usable,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp),shape=RoundedCornerShape(14.dp)) {
                        if(info.busy)CircularProgressIndicator(Modifier.size(20.dp),strokeWidth=2.dp)else Glyph(if(info.liked)"thumb-filled" else "thumb",color=MaterialTheme.colorScheme.primary)
                        Spacer(Modifier.width(10.dp));Text(if(info.busy)"Submitting" else if(info.liked)"Liked · Tap to unlike" else "Like this video")
                    }
                    Text("Choose collections",Modifier.padding(top=20.dp,bottom=4.dp),fontWeight=FontWeight.SemiBold)
                }
                items(model.biliActionFolders,key={it.id}) {folder->
                    Surface(onClick={command("bili-actions-choose",folder.id)},enabled=usable,shape=RoundedCornerShape(14.dp),modifier=Modifier.semantics {role=Role.Checkbox;stateDescription=if(folder.checked)"Selected" else "Not selected"},color=if(folder.checked)MaterialTheme.colorScheme.primaryContainer.copy(alpha=.4f)else MaterialTheme.colorScheme.surfaceContainer.copy(alpha=.7f)) {
                        Row(Modifier.fillMaxWidth().padding(start=12.dp,end=6.dp,top=7.dp,bottom=7.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                            Glyph("folder",color=MaterialTheme.colorScheme.primary)
                            Column(Modifier.weight(1f)) {Text(folder.title,maxLines=2,overflow=TextOverflow.Ellipsis);if(folder.privateFolder)Text("Private collection",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
                            Checkbox(checked=folder.checked,onCheckedChange=null,enabled=usable)
                        }
                    }
                }
                if(model.biliActionFolders.isEmpty())item {Text("This account has no collections. Create one in Bilibili then refresh.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
            }
            if(info.notice.isNotBlank())item {Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)) {Glyph("check",Modifier.size(18.dp),MaterialTheme.colorScheme.primary);Text(info.notice,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.primary)}}
            if(info.needsRefresh && !info.needsLogin)item {TextButton(onClick={command("bili-actions-refresh")},enabled=!info.busy && !info.loading,modifier=Modifier.fillMaxWidth()) {Text("Refresh and verify")}}
        }
    },confirmButton={Button(onClick={command("bili-actions-save")},enabled=usable && changed) {Text("Save collections")}},dismissButton={TextButton(onClick={command("dialog-close")}) {Text("Close")}})
}
