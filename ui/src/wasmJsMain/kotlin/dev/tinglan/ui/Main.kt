@file:OptIn(kotlin.js.ExperimentalJsExport::class, kotlin.js.ExperimentalWasmJsInterop::class, androidx.compose.ui.ExperimentalComposeUiApi::class)
package dev.tinglan.ui

import androidx.compose.runtime.snapshots.Snapshot
import androidx.compose.ui.window.ComposeViewport
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.toComposeImageBitmap
import org.jetbrains.skia.Image
import kotlin.io.encoding.Base64
import kotlin.js.JsExport

private val artwork = linkedMapOf<String, ImageBitmap>()
private val pageModelOrder = linkedSetOf<String>()
actual fun artworkFor(id: String): ImageBitmap? {
    val image = artwork.remove(id) ?: return null
    artwork[id] = image
    return image
}
actual fun command(action: String, payload: String): Unit = js("{ globalThis.tinglanDispatch?.(action, payload); }")

@JsExport fun setUiLanguage(language:String,translations:String) = Snapshot.withMutableSnapshot {
    configureTranslations(language,translations)
}

@JsExport fun updateUi(raw: String) = Snapshot.withMutableSnapshot {
    pageModelOrder.remove(model.viewKey);pageModelOrder.add(model.viewKey)
    // Account/login state belongs to the current session, never the retained page snapshots.
    pageModels[model.viewKey]=model.copy(dialogError="",accounts=emptyList(),login=AccountLoginInfo(),qrRows=emptyList(),biliActions=BilibiliActionInfo(),biliActionFolders=emptyList(),webdav=WebDavInfo(),transfer=TransferInfo(),transferQrRows=emptyList(),transferReceipts=emptyList(),transferSender=TransferSenderInfo(),presenceInfo=PresenceInfo(),liveCreators=emptyList(),presenceAnimating=false,noteEditor=NoteEditorInfo(),cacheTasks=emptyList(),audioInfo=AudioInfo(),audioDevices=emptyList(),recognition=RecognitionInfo(),localIndex=LocalIndexInfo()); model=decodeModel(raw)
    pageModels.remove(model.viewKey);pageModels[model.viewKey]=model.copy(dialogError="",accounts=emptyList(),login=AccountLoginInfo(),qrRows=emptyList(),biliActions=BilibiliActionInfo(),biliActionFolders=emptyList(),webdav=WebDavInfo(),transfer=TransferInfo(),transferQrRows=emptyList(),transferReceipts=emptyList(),transferSender=TransferSenderInfo(),presenceInfo=PresenceInfo(),liveCreators=emptyList(),presenceAnimating=false,noteEditor=NoteEditorInfo(),cacheTasks=emptyList(),audioInfo=AudioInfo(),audioDevices=emptyList(),recognition=RecognitionInfo(),localIndex=LocalIndexInfo())
    pageModelOrder.remove(model.viewKey);pageModelOrder.add(model.viewKey)
    while(pageModelOrder.size>24) {val oldest=pageModelOrder.first();pageModelOrder.remove(oldest);pageModels.remove(oldest)}
}
@JsExport fun updateClock(position: Double, active: Int) { clock = position.toLong(); lyricIndex = active }
@JsExport fun updateVideoClock(position:Double) {videoClock=position.toLong()}
private var videoMounted=false
@JsExport fun mountVideoControls() {if(!videoMounted){videoMounted=true;ComposeViewport("tinglan-video-controls") {VideoControlsScene()}}}
private var liveMounted=false
@JsExport fun mountLiveControls() {if(!liveMounted){liveMounted=true;ComposeViewport("tinglan-live-controls") {LiveControlsScene()}}}
@JsExport fun deliverArtwork(id: String, data: String) {
    if (data.isEmpty()) { artwork.remove(id); ++artRevision; return }
    try {
        val bitmap = Image.makeFromEncoded(Base64.decode(data)).toComposeImageBitmap()
        artwork[id] = bitmap
        var picturePixels=artwork.filterKeys {it.contains(":picture-")}.values.sumOf {it.width.toLong()*it.height}
        for(key in artwork.keys.filter {it.contains(":picture-")}) {if(picturePixels<=8_000_000)break;val old=artwork.remove(key)?:continue;picturePixels-=old.width.toLong()*old.height}
        listOf("gallery" to 3,"full" to 4,"thumb" to 120).forEach { (kind, limit) ->
            val keys = artwork.keys.filter {when(kind){"gallery"->it.endsWith(":gallery");"full"->it.endsWith(":full");else->!it.endsWith(":gallery") && !it.endsWith(":full") && !it.contains(":picture-")}}
            keys.take((keys.size - limit).coerceAtLeast(0)).forEach(artwork::remove)
        }
        ++artRevision
    } catch (_: Exception) { /* Keep the generated cover when an image cannot decode. */ }
}
@JsExport fun clearArtwork() { artwork.clear(); ++artRevision }
fun main() { ComposeViewport("tinglan-root") { TinglanApp() } }
