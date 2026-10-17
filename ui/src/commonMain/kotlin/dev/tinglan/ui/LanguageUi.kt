package dev.tinglan.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable internal fun LanguageChoiceSheet() {
    TinglanAlertDialog(onDismissRequest={command("dialog-close")},bottomSheet=true,
        title={Text(tr("Language"))},text={
            Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(10.dp)) {
                Text(tr("Choose your interface language. Music, lyrics and comments keep their original language."),color=MaterialTheme.colorScheme.onSurfaceVariant)
                listOf("en" to "English","zh-CN" to "简体中文").forEach {(id,label)->
                    SelectionRow(label,uiLanguage==id,description=if(id=="en")tr("Default language")else "Simplified Chinese") {
                        command("setting",payload("key" to "language","value" to id))
                        command("dialog-close")
                    }
                }
            }
        },confirmButton={})
}
