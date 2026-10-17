package dev.tinglan.ui

import androidx.compose.runtime.*
import kotlinx.serialization.json.*
import dev.tinglan.core.TimedDanmaku

@Immutable data class Song(
    val id: String, val title: String, val artist: String, val album: String = "",
    val duration: Long = 0, val favorite: Boolean = false, val cover: Boolean = false,
    val source: String = "local", val cached: Boolean = false,
    val lyricsSource: String = "",
    val creatorId:String="",
    val queueKey:String="",val queueIndex:Int=-1,val cacheMode:String="",val fileBytes:Long=0,
)
@Immutable data class Playlist(val id:String,val name:String,val ids:List<String>,val description:String="",val tags:List<String> = emptyList(),val background:String="none",val backgroundTrackId:String="",val backgroundOpacity:Float=.12f,val coverId:String="")
@Immutable data class Lyric(val at: Long, val text: String)
@Immutable data class CreatorResult(val id:String,val source:String,val name:String,val description:String,val avatarKey:String,val followers:Long)
@Immutable data class PlatformSection(val id: String, val title: String, val songs: List<Song>, val error: String, val loading: Boolean, val more: Boolean,val creators:List<CreatorResult> = emptyList(),val collapsed:Boolean=false)
@Immutable data class CommentEmote(val token:String,val key:String)
@Immutable data class CommentQuote(val author:String,val text:String)
@Immutable data class Comment(val id:String,val source:String,val author:String,val authorId:String,val text:String,val avatarKey:String,val likes:Long,val atText:String,val location:String,val badges:List<String>,val replyCount:Long,val pinned:Boolean,val authorLiked:Boolean,val quote:CommentQuote?,val previews:List<Comment>,val emotes:List<CommentEmote>,val pictures:List<String>)
@Immutable data class CommentInfo(val root:String="",val order:String="hot",val total:Long=0,val loading:Boolean=false,val warning:String="",val notice:String="",val next:String="",val subject:Song?=null,val parent:Comment?=null)
@Immutable data class CollectionInfo(val id:String="",val source:String="",val title:String="",val owner:String="",val description:String="",val coverKey:String="",val page:Int=1,val total:Long=0,val more:Boolean=false,val loading:Boolean=false,val warning:String="",val unavailable:Int=0)
@Immutable data class VideoQuality(val id:Int,val label:String)
@Immutable data class BilibiliPart(val number:Int,val cid:String,val title:String,val song:Song)
@Immutable data class BilibiliContextInfo(val bvid:String="",val title:String="",val loading:Boolean=false,val warning:String="",val collectionId:String="",val collectionTitle:String="",val collectionTotal:Int=0,val partial:Boolean=false)
@Immutable data class BilibiliActionInfo(val id:String="",val bvid:String="",val title:String="",val loaded:Boolean=false,val loading:Boolean=false,val busy:Boolean=false,val liked:Boolean=false,val needsRefresh:Boolean=false,val needsLogin:Boolean=false,val warning:String="",val notice:String="")
@Immutable data class BilibiliActionFolder(val id:String,val title:String,val selected:Boolean,val checked:Boolean,val privateFolder:Boolean=false)
@Immutable data class VideoInfo(val visible:Boolean=false,val status:String="idle",val quality:Int=0,val label:String="",val codec:String="",val error:String="",val width:Int=16,val height:Int=9,val background:Boolean=false,val qualities:List<VideoQuality> = emptyList(),val fullscreen:Boolean=false,val rate:Float=1f)
@Immutable data class CreatorInfo(val id:String,val source:String,val name:String,val description:String,val cover:Boolean,val followers:Long,val page:Int,val more:Boolean,val total:Int,val loading:Boolean,val warning:String)
@Immutable data class Activity(val id:String,val type:String,val authorId:String,val author:String,val avatarKey:String,val atText:String,val text:String,val title:String,val pictures:List<String>,val emotes:List<CommentEmote>,val song:Song?,val original:Activity?,val originalUnavailable:Boolean,val comments:Long,val likes:Long,val reposts:Long,val pinned:Boolean,val canComment:Boolean,val liveRoomId:String)
@Immutable data class FeedInfo(val loading:Boolean=false,val warning:String="",val notice:String="",val next:String="",val total:Long=0)
@Immutable data class PresenceInfo(val scope:String="",val id:String="",val known:Boolean=false,val liveRoomId:String="",val fetchedAt:Long=0,val loading:Boolean=false,val warning:String="")
@Immutable data class LiveCreator(val id:String,val name:String,val roomId:String,val title:String,val avatarKey:String)
@Immutable data class NoteItem(val songId:String,val title:String,val artists:String,val category:String,val preview:String,val dateLabel:String,val source:String,val hasArtwork:Boolean)
@Immutable data class NotesInfo(val query:String="",val category:String="",val count:Int=0,val page:Int=0,val pages:Int=1,val loading:Boolean=false,val warning:String="")
@Immutable data class NoteEditorInfo(val token:String="",val songId:String="",val title:String="",val artists:String="",val content:String="",val category:String=tr("Thoughts"),val loaded:Boolean=false,val loading:Boolean=false,val busy:Boolean=false,val exists:Boolean=false,val error:String="",val conflict:Boolean=false)
@Immutable data class LiveInfo(val roomId:String="",val title:String="",val creatorId:String="",val creatorName:String="",val area:String="",val description:String="",val viewers:Long=0,val live:Boolean=false,val status:String="idle",val error:String="",val quality:Int=0,val label:String="",val fullscreen:Boolean=false,val background:Boolean=false,val qualities:List<VideoQuality> = emptyList(),val muted:Boolean=false,val notice:String="",val desired:Boolean=false)
@Immutable data class AccountInfo(val source:String,val connected:Boolean,val status:String,val name:String,val error:String,val automaticRenewal:Boolean=false,val renewalStatus:String="missing",val renewalError:String="",val nextRenewalAt:Long=0)
@Immutable data class AccountLoginInfo(val source:String="",val status:String="idle",val error:String="",val remaining:Int=0,val imageKey:String="")
@Immutable data class WebDavInfo(val loaded:Boolean=false,val connected:Boolean=false,val busy:Boolean=false,val configRevision:String="",val endpoint:String="",val username:String="",val deviceName:String=tr("Tinglan Web"),val warning:String="",val notice:String="",val needsRefresh:Boolean=false,val pendingResume:Boolean=false,val remoteTitle:String="",val remoteArtist:String="",val remoteDevice:String="",val remoteCount:Int=0,val remotePosition:Long=0,val remoteExpired:Boolean=false,val incomingIssue:String="",val canReceive:Boolean=false,val canSend:Boolean=false)
@Immutable data class LanAddress(val name:String,val address:String)
@Immutable data class TransferReceipt(val id:String,val name:String,val size:Long,val status:String,val error:String)
@Immutable data class TransferInfo(val loaded:Boolean=false,val active:Boolean=false,val busy:Boolean=false,val addresses:List<LanAddress> = emptyList(),val filename:String="",val progress:Float=0f,val receiving:Boolean=false,val importing:String="",val warning:String="",val notice:String="",val needsStop:Boolean=false)
@Immutable data class TransferFile(val name:String,val size:Long) {val megabytes:String get()="${(size/104857.6).toLong()/10.0}"}
@Immutable data class TransferSenderInfo(val files:List<TransferFile> = emptyList(),val busy:Boolean=false,val filename:String="",val progress:Float=0f,val completed:Int=0,val total:Int=0,val error:String="",val notice:String="")
@Immutable data class UiModel(
    val staticHosting: Boolean = false, val ready: Boolean = false, val page: String = "home", val viewKey:String="home", val tab: String = "songs",
    val songs: List<Song> = emptyList(), val playlists: List<Playlist> = emptyList(),
    val libraryInfo:LibraryInfo=LibraryInfo(),val font:String="sans",val motionPreset:String="fast",val lyricsSize:Int=26,val guideEnabled:Boolean=true,val guideSeen:List<String> = emptyList(),
    val queue: List<Song> = emptyList(), val current: Song? = null, val lyrics: List<Lyric> = emptyList(),
    val queueTotal: Int = 0, val queueOffset: Int = 0,val queueCurrentKey:String="",
    val queueDuration:Long=0,val queueLocked:Boolean=false,val queueFocus:Int=0,val queueUndo:String="",val shuffle:Boolean=false,
    val lyricSource:LyricSourceInfo=LyricSourceInfo(),
    val sections: List<PlatformSection> = emptyList(), val query: String = "", val source: String = "all",
    val player: Boolean = false, val queueOpen: Boolean = false, val status: String = "idle",val playbackHint:String="",
    val theme: String = "system", val dark: Boolean = false, val reduced: Boolean = false,
    val autoOpen: Boolean = true, val volume: Float = .8f, val repeat: String = "OFF",
    val busy: Boolean = false, val progress: Float = 0f, val message: String = "", val toast: String = "",
    val dialog: String = "", val dialogError:String="", val target: String = "",val targetQueueKey:String="",val dialogText: String = "", val menuContext: String = "",
    val playlistId: String = "", val storage: String = "", val error: String = "",
    val searchPreference: String = "qq", val backupText: String = "",
    val updateAvailable: Boolean = false,val updatePrompt:Boolean=false,val updateApplying:Boolean=false,
    val webIntegration:WebIntegrationInfo=WebIntegrationInfo(),
    val audioInfo:AudioInfo=AudioInfo(),val audioDevices:List<AudioDevice> = emptyList(),
    val recognition:RecognitionInfo=RecognitionInfo(),
    val localIndex:LocalIndexInfo=LocalIndexInfo(),
    val cacheInfo:CacheInfo=CacheInfo(),val cacheItems:List<Song> = emptyList(),val cacheTasks:List<CacheTask> = emptyList(),
    val video:VideoInfo=VideoInfo(),val danmaku:List<TimedDanmaku> = emptyList(),
    val live:LiveInfo=LiveInfo(),val gallery:GalleryInfo=GalleryInfo(),
    val accounts:List<AccountInfo> = emptyList(),val accountSource:String="",val accountLoaded:Boolean=false,val accountLoading:Boolean=false,val accountError:String="",val accountChecking:String="",val accountChanging:Boolean=false,val login:AccountLoginInfo=AccountLoginInfo(),val qrRows:List<String> = emptyList(),
    val creator:CreatorInfo?=null,val creatorSongs:List<Song> = emptyList(),
    val searchHistory:List<String> = emptyList(),val searchKind:String="songs",val comments:List<Comment> = emptyList(),val commentInfo:CommentInfo?=null,
    val collectionSongs:List<Song> = emptyList(),val collectionInfo:CollectionInfo?=null,val importingCollection:Boolean=false,
    val biliInfo:BilibiliContextInfo?=null,val biliParts:List<BilibiliPart> = emptyList(),val biliCollectionSongs:List<Song> = emptyList(),
    val biliActions:BilibiliActionInfo=BilibiliActionInfo(),val biliActionFolders:List<BilibiliActionFolder> = emptyList(),
    val webdav:WebDavInfo=WebDavInfo(),
    val transfer:TransferInfo=TransferInfo(),val transferQrRows:List<String> = emptyList(),val transferReceipts:List<TransferReceipt> = emptyList(),val transferSender:TransferSenderInfo=TransferSenderInfo(),
    val creatorTab:String="works",val followingTab:String="dynamics",val feedInfo:FeedInfo=FeedInfo(),val activities:List<Activity> = emptyList(),val dynamicInfo:FeedInfo=FeedInfo(),val activityDetails:List<Activity> = emptyList(),val followingInfo:FeedInfo=FeedInfo(),val followingCreators:List<CreatorResult> = emptyList(),
    val presenceInfo:PresenceInfo=PresenceInfo(),val liveCreators:List<LiveCreator> = emptyList(),val presenceAnimating:Boolean=false,
    val notesInfo:NotesInfo=NotesInfo(),val noteItems:List<NoteItem> = emptyList(),val noteCategories:List<String> = emptyList(),val noteEditor:NoteEditorInfo=NoteEditorInfo(),val noteCount:Int=0,
    val statsInfo:StatisticsInfo=StatisticsInfo(),val statsReport:StatisticsReport?=null,
    val radioPage:RadioPageInfo=RadioPageInfo(),val radio:RadioPlaybackInfo=RadioPlaybackInfo(),val radioItems:List<RadioStationUi> = emptyList(),val radioQueue:List<RadioStationUi> = emptyList(),val radioAdding:Boolean=false,val radioAddError:String="",
    val danmakuEnabled:Boolean=false,val danmakuSize:Float=22f,val danmakuAlpha:Float=.85f,val danmakuArea:Float=.5f,val danmakuSpeed:Float=1f,val danmakuDensity:Int=16,val danmakuFps:Int=30,val danmakuBlocked:String="",
)

var model by mutableStateOf(UiModel())
val pageModels = mutableStateMapOf<String,UiModel>()
var clock by mutableStateOf(0L)
var lyricIndex by mutableStateOf(-1)
var artRevision by mutableStateOf(0)
var videoClock by mutableStateOf(0L)
private fun JsonObject.s(key: String, default: String = "") = this[key]?.jsonPrimitive?.contentOrNull ?: default
private fun JsonObject.b(key: String) = this[key]?.jsonPrimitive?.booleanOrNull == true
private fun JsonObject.n(key: String) = this[key]?.jsonPrimitive?.doubleOrNull ?: 0.0
private fun JsonObject.a(key: String) = (this[key] as? JsonArray) ?: JsonArray(emptyList())
internal fun song(value: JsonElement): Song {
    val o = value.jsonObject
    return Song(o.s("id"), o.s("title"), o.s("artist"), o.s("album"), o.n("durationMs").toLong(), o.b("favorite"), o.b("hasArtwork"), o.s("source", "local"), o.b("cached"), o.s("lyricsSource"),o.s("creatorId"),o.s("queueKey"),if("queueIndex" in o)o.n("queueIndex").toInt()else -1,o.s("cacheMode"),o.n("fileBytes").toLong())
}
private fun comment(value:JsonElement,depth:Int=0):Comment {
    val o=value.jsonObject
    return Comment(o.s("id"),o.s("source"),o.s("author"),o.s("authorId"),o.s("text"),o.s("avatarKey"),o.n("likes").toLong(),o.s("atText"),o.s("location"),o.a("badges").map {it.jsonPrimitive.content},o.n("replyCount").toLong(),o.b("pinned"),o.b("authorLiked"),
        (o["quote"] as? JsonObject)?.let {CommentQuote(it.s("author"),it.s("text"))},if(depth==0)o.a("previews").take(3).map {comment(it,1)}else emptyList(),
        o.a("emotes").take(40).map {it.jsonObject.let {e->CommentEmote(e.s("token"),e.s("key"))}},o.a("pictures").take(9).map {it.jsonPrimitive.content})
}
private fun activity(value:JsonElement,depth:Int=0):Activity {
    val a=value.jsonObject
    return Activity(a.s("id"),a.s("type"),a.s("authorId"),a.s("author"),a.s("avatarKey"),a.s("atText"),a.s("text"),a.s("title"),a.a("pictures").take(9).map {it.jsonPrimitive.content},a.a("emotes").take(100).map {it.jsonObject.let {e->CommentEmote(e.s("token"),e.s("key"))}},(a["song"] as? JsonObject)?.let(::song),if(depth==0)(a["original"] as? JsonObject)?.let {activity(it,1)}else null,a.b("originalUnavailable"),a.n("comments").toLong(),a.n("likes").toLong(),a.n("reposts").toLong(),a.b("pinned"),a["commentTarget"] is JsonObject,a.s("liveRoomId"))
}
private fun feed(value:JsonElement?):FeedInfo = (value as? JsonObject)?.let {FeedInfo(it.b("loading"),it.s("warning"),it.s("notice"),it.s("next"),it.n("total").toLong())} ?: FeedInfo()
private fun station(value:JsonElement):RadioStationUi = value.jsonObject.let {s->RadioStationUi(s.s("id"),s.s("name"),s.s("description"),s.s("coverKey"),s.b("favorite"),s.s("category"),s.b("custom"))}
private fun statistics(value:JsonElement?):StatisticsReport? = (value as? JsonObject)?.let {o->
    fun ranks(key:String)=o.a(key).take(50).map {it.jsonObject.let {r->StatisticsRank(r.s("key"),r.s("label"),r.s("songId"),r.s("source"),r.s("creatorId"),r.n("totalMs").toLong(),r.n("plays").toInt())}}
    StatisticsReport(o.s("label"),o.n("totalMs").toLong(),o.n("plays").toInt(),o.n("songCount").toInt(),o.n("artistCount").toInt(),o.n("days").toInt(),o.n("averageMs").toLong(),o.a("points").take(50).map {it.jsonObject.let {p->StatisticsPoint(p.s("label"),p.n("value").toLong())}},o.a("hours").take(24).map {it.jsonPrimitive.longOrNull ?: 0L},ranks("songs"),ranks("artists"),ranks("albums"))
}
fun decodeModel(raw: String): UiModel {
    val o = Json.parseToJsonElement(raw).jsonObject
    val view=o.s("viewKey",o.s("page",model.page))
    val previous=pageModels[view] ?: model
    return UiModel(
        staticHosting = o.b("staticHosting"), ready = o.b("ready"), page = o.s("page", "home"), viewKey=view, tab = o.s("tab", "songs"), songs = if("songs" in o)o.a("songs").map(::song)else previous.songs,
        playlists = if("playlists" in o)o.a("playlists").map { it.jsonObject.let { p -> Playlist(p.s("id"),p.s("name"),p.a("trackIds").map {id->id.jsonPrimitive.content},p.s("description"),p.a("tags").map {it.jsonPrimitive.content},p.s("background","none"),p.s("backgroundTrackId"),if("backgroundOpacity" in p)p.n("backgroundOpacity").toFloat()else .12f,p.s("coverId")) } }else previous.playlists,
        libraryInfo=if("libraryInfo" in o)readLibrary(o["libraryInfo"])else previous.libraryInfo,font=o.s("font","sans"),motionPreset=o.s("motionPreset","fast"),lyricsSize=if("lyricsSize" in o)o.n("lyricsSize").toInt()else 26,guideEnabled=o["guideEnabled"]?.jsonPrimitive?.booleanOrNull!=false,guideSeen=o.a("guideSeen").map {it.jsonPrimitive.content},
        queue = if("queue" in o)o.a("queue").map(::song)else previous.queue, queueTotal=o.n("queueTotal").toInt(),queueOffset=o.n("queueOffset").toInt(),queueCurrentKey=o.s("queueCurrentKey"),current = o["current"]?.takeUnless { it is JsonNull }?.let(::song),
        queueDuration=o.n("queueDuration").toLong(),queueLocked=o.b("queueLocked"),queueFocus=o.n("queueFocus").toInt(),queueUndo=o.s("queueUndo"),shuffle=o.b("shuffle"),
        lyricSource=o["lyricSource"]?.takeUnless {it is JsonNull}?.jsonObject?.let {s->LyricSourceInfo(s.s("id"),s.s("title"),s.s("artist"),s.n("durationMs").toLong(),s.s("provider","platform"),s.b("adjusted"),s.b("loading"),s.s("error"),s.s("notice"))} ?: LyricSourceInfo(),
        lyrics = if("lyrics" in o)o.a("lyrics").map { it.jsonObject.let { l -> Lyric(l.n("timeMs").toLong(), l.s("text")) } }else previous.lyrics,
        sections = if("sections" in o)o.a("sections").map { it.jsonObject.let { p -> PlatformSection(p.s("id"), p.s("title"), p.a("songs").map(::song), p.s("error"), p.b("loading"), p.b("more"),p.a("creators").map {it.jsonObject.let {c->CreatorResult(c.s("id"),c.s("source"),c.s("name"),c.s("description"),c.s("avatarKey"),c.n("followers").toLong())}},p.b("collapsed")) } }else previous.sections,
        searchHistory=o.a("searchHistory").map {it.jsonPrimitive.content},query = o.s("query"), source = o.s("source", "all"), player = o.b("player"), queueOpen = o.b("queueOpen"), status = o.s("status", "idle"),playbackHint=o.s("playbackHint"),
        theme = o.s("theme", "system"), dark = o.b("dark"), reduced = o.b("reduceMotion"), autoOpen = o.b("autoOpen"), volume = o.n("volume").toFloat(), repeat = o.s("repeat", "OFF"),
        busy = o.b("busy"), progress = o.n("progress").toFloat(), message = o.s("message"), toast = o.s("toast"), dialog = o.s("dialog"), dialogError=o.s("dialogError"), target = o.s("target"),targetQueueKey=o.s("targetQueueKey"),dialogText = o.s("dialogText"), menuContext = o.s("menuContext"),
        playlistId = o.s("playlistId"), storage = o.s("storage"), error = o.s("error"), searchPreference = o.s("searchPreference", "qq"), backupText = o.s("backupText"),
        updateAvailable = o.b("updateAvailable"),updatePrompt=o.b("updatePrompt"),updateApplying=o.b("updateApplying"),webIntegration=(o["webIntegration"] as? JsonObject)?.let(::webIntegrationInfo)?:WebIntegrationInfo(),
        recognition=if("recognition" in o)readRecognition(o["recognition"])else model.recognition,
        localIndex=if("localIndex" in o)readLocalIndex(o["localIndex"])else model.localIndex,
        cacheInfo=(o["cacheInfo"] as? JsonObject)?.let {c->CacheInfo(autoEnabled=c.b("autoEnabled"),limitMb=if("limitMb" in c)c.n("limitMb").toInt()else 1024,keepFavorites=c["keepFavorites"]?.jsonPrimitive?.booleanOrNull!=false,loading=c.b("loading"),cleaning=c.b("cleaning"),warning=c.s("warning"),automaticBytes=c.n("automaticBytes").toLong(),downloadBytes=c.n("downloadBytes").toLong(),localBytes=c.n("localBytes").toLong(),artworkBytes=c.n("artworkBytes").toLong(),usage=c.n("usage").toLong(),quota=c.n("quota").toLong(),automaticCount=c.n("automaticCount").toInt(),downloadCount=c.n("downloadCount").toInt(),localCount=c.n("localCount").toInt(),filter=c.s("filter","all"),page=c.n("page").toInt(),pages=c.n("pages").toInt().coerceAtLeast(1),count=c.n("count").toInt(),notice=(c["notice"] as? JsonObject)?.let {n->CacheNotice(n.s("token"),n.n("used").toLong(),n.n("limit").toLong())})} ?: CacheInfo(),
        cacheItems=if("cacheItems" in o)o.a("cacheItems").take(24).map(::song)else previous.cacheItems,
        audioInfo=if("audioInfo" in o)readAudioInfo(o["audioInfo"]) else model.audioInfo,audioDevices=if("audioDevices" in o)o.a("audioDevices").take(32).map {it.jsonObject.let {d->AudioDevice(d.s("id"),d.s("label"))}}else model.audioDevices,
        cacheTasks=if("cacheTasks" in o)o.a("cacheTasks").take(40).map {it.jsonObject.let {t->CacheTask(t.s("id"),t.s("title"),t.s("mode","download"),t.s("status","queued"),t.n("progress").toFloat(),t.n("done").toLong(),t.n("total").toLong(),t.s("error"),t.s("warning"))}}else model.cacheTasks,
        accounts=if("accounts" in o)o.a("accounts").map {it.jsonObject.let {a->AccountInfo(a.s("source"),a.b("connected"),a.s("status"),a.s("name"),a.s("error"),a.b("automaticRenewal"),a.s("renewalStatus","missing"),a.s("renewalError"),a.n("nextRenewalAt").toLong())}}else model.accounts,
        accountSource=o.s("accountSource"),accountLoaded=o.b("accountLoaded"),accountLoading=o.b("accountLoading"),accountError=o.s("accountError"),accountChecking=o.s("accountChecking"),accountChanging=o.b("accountChanging"),
        login=(o["login"] as? JsonObject)?.let {l->AccountLoginInfo(l.s("source"),l.s("status","idle"),l.s("error"),l.n("remaining").toInt(),l.s("imageKey"))} ?: AccountLoginInfo(),
        qrRows=if("qrRows" in o)o.a("qrRows").map {it.jsonPrimitive.content}else model.qrRows,
        biliActions=(o["biliActions"] as? JsonObject)?.let {a->BilibiliActionInfo(a.s("id"),a.s("bvid"),a.s("title"),a.b("loaded"),a.b("loading"),a.b("busy"),a.b("liked"),a.b("needsRefresh"),a.b("needsLogin"),a.s("warning"),a.s("notice"))} ?: BilibiliActionInfo(),
        biliActionFolders=if("biliActionFolders" in o)o.a("biliActionFolders").map {it.jsonObject.let {f->BilibiliActionFolder(f.s("id"),f.s("title"),f.b("selected"),f.b("checked"),f.b("private"))}}else model.biliActionFolders,
        webdav=(o["webdav"] as? JsonObject)?.let {w->WebDavInfo(loaded=w.b("loaded"),connected=w.b("connected"),busy=w.b("busy"),configRevision=w.s("configRevision"),endpoint=w.s("endpoint"),username=w.s("username"),deviceName=w.s("deviceName",tr("Tinglan Web")),warning=w.s("warning"),notice=w.s("notice"),needsRefresh=w.b("needsRefresh"),pendingResume=w.b("pendingResume"),remoteTitle=w.s("remoteTitle"),remoteArtist=w.s("remoteArtist"),remoteDevice=w.s("remoteDevice"),remoteCount=w.n("remoteCount").toInt(),remotePosition=w.n("remotePosition").toLong(),remoteExpired=w.b("remoteExpired"),incomingIssue=w.s("incomingIssue"),canReceive=w.b("canReceive"),canSend=w.b("canSend"))} ?: WebDavInfo(),
        transfer=(o["transfer"] as? JsonObject)?.let {t->TransferInfo(loaded=t.b("loaded"),active=t.b("active"),busy=t.b("busy"),addresses=t.a("addresses").map {it.jsonObject.let {a->LanAddress(a.s("name"),a.s("address"))}},filename=t.s("filename"),progress=t.n("progress").toFloat(),receiving=t.b("receiving"),importing=t.s("importing"),warning=t.s("warning"),notice=t.s("notice"),needsStop=t.b("needsStop"))} ?: TransferInfo(),
        transferQrRows=if("transferQrRows" in o)o.a("transferQrRows").map {it.jsonPrimitive.content}else model.transferQrRows,
        transferReceipts=if("transferReceipts" in o)o.a("transferReceipts").map {it.jsonObject.let {t->TransferReceipt(t.s("id"),t.s("name"),t.n("size").toLong(),t.s("status"),t.s("error"))}}else model.transferReceipts,
        transferSender=(o["transferSender"] as? JsonObject)?.let {t->TransferSenderInfo(files=t.a("files").map {it.jsonObject.let {f->TransferFile(f.s("name"),f.n("size").toLong())}},busy=t.b("busy"),filename=t.s("filename"),progress=t.n("progress").toFloat(),completed=t.n("completed").toInt(),total=t.n("total").toInt(),error=t.s("error"),notice=t.s("notice"))} ?: TransferSenderInfo(),
        gallery=(o["gallery"] as? JsonObject)?.let {g->GalleryInfo(g.b("open"),g.a("keys").take(9).map {it.jsonPrimitive.content},g.n("index").toInt(),g.s("status"),g.s("error"))} ?: GalleryInfo(),
        live=(o["live"] as? JsonObject)?.let {l->val r=l["room"] as? JsonObject;LiveInfo(l.s("roomId"),r?.s("title").orEmpty(),r?.s("creatorId").orEmpty(),r?.s("creatorName").orEmpty(),r?.s("area").orEmpty(),r?.s("description").orEmpty(),r?.n("viewers")?.toLong() ?: 0,r?.b("live") ?: false,l.s("status"),l.s("error"),l.n("quality").toInt(),l.s("label"),l.b("fullscreen"),l.b("background"),l.a("qualities").map {it.jsonObject.let {q->VideoQuality(q.n("id").toInt(),q.s("label"))}},l.b("muted"),l.s("notice"),l.b("desired"))} ?: LiveInfo(),
        video=(o["video"] as? JsonObject)?.let {v->VideoInfo(v.b("visible"),v.s("status"),v.n("quality").toInt(),v.s("label"),v.s("codec"),v.s("error"),v.n("width").toInt().coerceAtLeast(1),v.n("height").toInt().coerceAtLeast(1),v.b("background"),v.a("qualities").map {it.jsonObject.let {q->VideoQuality(q.n("id").toInt(),q.s("label"))}},v.b("fullscreen"),if("rate" in v)v.n("rate").toFloat() else 1f)} ?: VideoInfo(),
        danmaku=if("danmaku" in o)o.a("danmaku").map {it.jsonObject.let {d->TimedDanmaku(d.n("at").toLong(),d.s("text"),d.n("mode").toInt(),d.n("color").toInt())}}else previous.danmaku,
        creator=(o["creator"] as? JsonObject)?.let {c ->(c["profile"] as? JsonObject)?.let {p->CreatorInfo(c.s("id"),c.s("source"),p.s("name"),p.s("description"),p.b("hasArtwork"),p.n("followers").toLong(),c.n("page").toInt(),c.b("more"),c.n("total").toInt(),c.b("loading"),c.s("warning"))}},
        creatorSongs=if("creatorSongs" in o)o.a("creatorSongs").map(::song)else previous.creatorSongs,
        searchKind=o.s("searchKind","songs"),comments=if("comments" in o)o.a("comments").map {comment(it)}else previous.comments,
        commentInfo=(o["commentInfo"] as? JsonObject)?.let {c->val r=c["request"] as? JsonObject;CommentInfo(r?.s("root").orEmpty(),r?.s("order","hot") ?: "hot",c.n("total").toLong(),c.b("loading"),c.s("warning"),c.s("notice"),c.s("next"),(c["subject"] as? JsonObject)?.let(::song),(c["parent"] as? JsonObject)?.let {comment(it)})},
        collectionSongs=if("collectionSongs" in o)o.a("collectionSongs").map(::song)else previous.collectionSongs,
        collectionInfo=(o["collectionInfo"] as? JsonObject)?.let {c->val p=c["playlist"] as? JsonObject;val r=c["request"] as? JsonObject;CollectionInfo(p?.s("id") ?: r?.s("id").orEmpty(),p?.s("source") ?: r?.s("source").orEmpty(),p?.s("title").orEmpty(),p?.s("owner").orEmpty(),p?.s("description").orEmpty(),p?.s("coverKey").orEmpty(),r?.n("page")?.toInt() ?: 1,c.n("total").toLong(),c.b("more"),c.b("loading"),c.s("warning"),c.n("unavailable").toInt())},importingCollection=o.b("importingCollection"),
        biliInfo=(o["biliInfo"] as? JsonObject)?.let {c->val p=c["collection"] as? JsonObject;BilibiliContextInfo(c.s("bvid"),c.s("title"),c.b("loading"),c.s("warning"),p?.s("id").orEmpty(),p?.s("title").orEmpty(),p?.n("total")?.toInt() ?: 0,p?.b("partial") ?: false)},
        biliParts=if("biliParts" in o)o.a("biliParts").map {it.jsonObject.let {p->BilibiliPart(p.n("number").toInt(),p.s("cid"),p.s("title"),song(p.getValue("song")))}}else previous.biliParts,
        biliCollectionSongs=if("biliCollectionSongs" in o)o.a("biliCollectionSongs").map(::song)else previous.biliCollectionSongs,
        creatorTab=o.s("creatorTab","works"),followingTab=o.s("followingTab","dynamics"),feedInfo=feed(o["feedInfo"]),activities=if("activities" in o)o.a("activities").map {activity(it)}else previous.activities,
        dynamicInfo=feed(o["dynamicInfo"]),activityDetails=if("activityDetails" in o)o.a("activityDetails").map {activity(it)}else previous.activityDetails,
        followingInfo=feed(o["followingInfo"]),followingCreators=if("followingCreators" in o)o.a("followingCreators").map {it.jsonObject.let {c->CreatorResult(c.s("id"),c.s("source"),c.s("name"),c.s("description"),c.s("avatarKey"),c.n("followers").toLong())}}else previous.followingCreators,
        presenceInfo=(o["presenceInfo"] as? JsonObject)?.let {p->PresenceInfo(p.s("scope"),p.s("id"),p.b("known"),p.s("liveRoomId"),p.n("fetchedAt").toLong(),p.b("loading"),p.s("warning"))} ?: PresenceInfo(),
        liveCreators=if("liveCreators" in o)o.a("liveCreators").map {it.jsonObject.let {c->LiveCreator(c.s("id"),c.s("name"),c.s("roomId"),c.s("title"),c.s("avatarKey"))}}else model.liveCreators,presenceAnimating=o.b("presenceAnimating"),
        notesInfo=(o["notesInfo"] as? JsonObject)?.let {n->NotesInfo(n.s("query"),n.s("category"),n.n("count").toInt(),n.n("page").toInt(),n.n("pages").toInt().coerceAtLeast(1),n.b("loading"),n.s("warning"))} ?: NotesInfo(),
        noteItems=if("noteItems" in o)o.a("noteItems").map {it.jsonObject.let {n->NoteItem(n.s("songId"),n.s("title"),n.s("artists"),n.s("category"),n.s("preview"),n.s("dateLabel"),n.s("source","local"),n.b("hasArtwork"))}}else previous.noteItems,
        noteCategories=if("noteCategories" in o)o.a("noteCategories").map {it.jsonPrimitive.content}else previous.noteCategories,
        statsInfo=(o["statsInfo"] as? JsonObject)?.let {s->StatisticsInfo(s.s("period","month"),s.n("offset").toInt(),s.b("loading"),s.s("warning"),s.b("recording"))} ?: StatisticsInfo(),statsReport=if("statsReport" in o)statistics(o["statsReport"])else previous.statsReport,
        radioPage=(o["radioPage"] as? JsonObject)?.let {r->RadioPageInfo(r.s("scope","domestic"),r.s("query"),r.b("loading"),r.b("loadingMore"),r.b("more"),r.s("error"),r.s("loadingRadioId"))} ?: RadioPageInfo(),
        radio=(o["radioInfo"] as? JsonObject)?.let {r->RadioPlaybackInfo(r.b("active"),r.s("status","idle"),(r["station"] as? JsonObject)?.let(::station),r.s("error"))} ?: RadioPlaybackInfo(),radioItems=if("radioItems" in o)o.a("radioItems").take(400).map(::station)else previous.radioItems,radioQueue=if("radioQueue" in o)o.a("radioQueue").take(400).map(::station)else model.radioQueue,radioAdding=o.b("radioAdding"),radioAddError=o.s("radioAddError"),
        noteEditor=if("noteEditor" in o)(o["noteEditor"] as? JsonObject)?.let {n->NoteEditorInfo(n.s("token"),n.s("songId"),n.s("title"),n.s("artists"),n.s("content"),n.s("category",tr("Thoughts")),n.b("loaded"),n.b("loading"),n.b("busy"),n.b("exists"),n.s("error"),n.b("conflict"))} ?: NoteEditorInfo() else model.noteEditor,noteCount=o.n("noteCount").toInt(),
        danmakuEnabled=o.b("danmakuEnabled"),danmakuSize=o.n("danmakuSize").toFloat(),danmakuAlpha=o.n("danmakuAlpha").toFloat(),danmakuArea=o.n("danmakuArea").toFloat(),danmakuSpeed=o.n("danmakuSpeed").toFloat(),danmakuDensity=o.n("danmakuDensity").toInt(),danmakuFps=o.n("danmakuFps").toInt(),danmakuBlocked=o.s("danmakuBlocked"),
    )
}
fun timestamp(ms: Long): String {
    val seconds = ms.coerceAtLeast(0) / 1000
    return "${seconds / 60}:${(seconds % 60).toString().padStart(2, '0')}"
}
