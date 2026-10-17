package dev.tinglan.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

@Composable internal fun SearchHistoryGrid(history:List<String>) {
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val columns=when {maxWidth>=840.dp->3;maxWidth>=540.dp->2;else->1}
        Column(verticalArrangement=Arrangement.spacedBy(8.dp)) {
            history.chunked(columns).forEach {row->Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(10.dp)) {
                row.forEach {term->Surface(onClick={command("search-history-use",term)},modifier=Modifier.weight(1f),shape=RoundedCornerShape(18.dp),color=MaterialTheme.colorScheme.surfaceContainerLow) {
                    Row(Modifier.heightIn(min=52.dp).padding(start=14.dp,end=4.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                        Glyph("clock",Modifier.size(18.dp),MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(term,Modifier.weight(1f),maxLines=1,overflow=TextOverflow.Ellipsis,style=MaterialTheme.typography.bodyMedium)
                        Action("close",tr("Remove search entry: {0}", term),color=MaterialTheme.colorScheme.onSurfaceVariant){command("search-history-remove",term)}
                    }
                }}
                repeat(columns-row.size){Spacer(Modifier.weight(1f))}
            }}
        }
    }
}
