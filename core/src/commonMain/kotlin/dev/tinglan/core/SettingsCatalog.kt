package dev.tinglan.core

/** Navigation metadata contains only browser capabilities actually exposed by the UI. */
data class SettingEntry(val id:String,val group:String,val title:String,val summary:String,val icon:String,val action:String="",val value:String="",val keywords:String="")
object SettingsCatalog {
    val entries=listOf(
        SettingEntry("accounts","Accounts & platforms","Accounts & platforms","Manage QQ Music, Bilibili and NetEase accounts","account","accounts-open",keywords="sign in QR code cookie QQ WeChat phone number"),
        SettingEntry("theme","Appearance & interaction","Theme","Choose light, dark, or system appearance","palette","dialog","theme", "color night appearance"),
        SettingEntry("font","Appearance & interaction","App font","Noto Sans SC, Noto Serif SC, LXGW WenKai, and Nunito","font","dialog","font","text font typeface"),
        SettingEntry("motion-preset","Appearance & interaction","Animation speed","Fast or relaxed page and player transitions","motion","dialog","motion-preset","curve speed animation"),
        SettingEntry("lyrics-appearance","Appearance & interaction","Lyrics text size","Adjust fullscreen lyrics text size","lyrics","dialog","lyrics-appearance","lyrics font size"),
        SettingEntry("guides","Appearance & interaction","Feature guides","Focus controls on first use, or revisit their guides","help","dialog","guides","beginner tutorial focus"),
        SettingEntry("motion","Appearance & interaction","Reduce motion","Shorter page and player effects with less movement","motion",keywords="animation transition performance accessibility"),
        SettingEntry("autoOpen","Playback & sound","Open player when selecting music","Open the player immediately and show buffering progress","expand",keywords="fullscreen playback window"),
        SettingEntry("volume","Playback & sound","Playback volume","Adjust only Tinglan’s playback volume","volume",keywords="sound volume"),
        SettingEntry("sound","Playback & sound","Sound & playback device","Output devices, loudness, equalizer, and stereo tuning","headphones","audio-open",keywords="headphones Bluetooth USB effects speakers EQ"),
        SettingEntry("search","Content & discovery","Search preferences","Show your preferred platform first; expand or collapse results","sliders","dialog","search-preference","QQ Bilibili B Bilibili NetEase order"),
        SettingEntry("recognition","Content & discovery","Identify music","Listen for six seconds or choose audio; supports local fingerprints","recognition","recognition-open",keywords="microphone identify offline audio"),
        SettingEntry("video","Content & discovery","Video & scrolling comments","Adjust overlay opacity, area, density, frame rate, and blocked words","video","dialog","danmaku-settings","Bilibili B Bilibili quality decoder"),
        SettingEntry("statistics","Content & discovery","Listening report","View listening time, tracks, and artists recorded on this device","chart","statistics-open",keywords="statistics history privacy"),
        SettingEntry("radio","Content & discovery","Internet radio","Find stations, QQ theme stations, or add your own URL","radio","radio-open",keywords="FM radio live"),
        SettingEntry("files","Library & storage","Import local music","Choose audio files or folders to store in this browser","folder","settings-local",keywords="local folder OTG U drive USB"),
        SettingEntry("cache","Library & storage","Downloads & cache","Manage downloads, offline music, and automatic cache usage","download","cache-open",keywords="space capacity cleanup storage"),
        SettingEntry("export","Library & storage","Export full backup","Save music, artwork, lyrics, playlists, notes, and settings","backup","backup-export",keywords="export storage statistics radio privacy"),
        SettingEntry("restore","Library & storage","Restore backup","Validate and preview before merging into your library","restore","backup-import",keywords="import migrate restore"),
        SettingEntry("webdav","Devices & handoff","WebDAV Playback handoff","Send or receive playback position to continue on another device","cloud-sync","webdav-open",keywords="NAS cloud sync account"),
        SettingEntry("lan","Devices & handoff","LAN music transfer","Scan on the same network to receive audio while this page is visible","network","transfer-open",keywords="WiFi share QR files"),
        SettingEntry("web-integration","Devices & handoff","Install & notifications","Install the app, download alerts, and system media controls","install","dialog","web-integration","PWA Windows Android notifications background install"),
        SettingEntry("about","About","About Tinglan","Version, project details, and open-source licenses","info","dialog","about","version GPL license terms")
    )
    private fun normalized(value:String)=buildString {value.take(200).forEach {c->append(when(c.code){in 0xFF01..0xFF5E->(c.code-0xFEE0).toChar();0x3000->' ';else->c})}}.lowercase()
    fun search(query:String):List<SettingEntry> {
        val words=normalized(query).split(Regex("\\s+")).filter {it.isNotEmpty()}.take(12)
        if(words.isEmpty())return entries
        return entries.filter {entry->val text=normalized("${entry.title} ${entry.summary} ${entry.keywords} ${entry.group}");words.all(text::contains)}
    }
}

data class AccountPresentation(val title:String,val detail:String,val icon:String,val attention:Boolean=false)
fun accountPresentation(loaded:Boolean,connected:Boolean,status:String,checking:Boolean=false):AccountPresentation=when {
    checking->AccountPresentation("Verifying","If verification is unavailable, the session is preserved and you stay signed in.","refresh")
    !loaded->AccountPresentation("Status not loaded","Refresh account status or check the local companion connection.","help")
    !connected->AccountPresentation("Not signed in","Public content is available. Some playback and interactions require sign-in.","account")
    status=="expired"->AccountPresentation("Session expired","The platform requires sign-in again. Local music and playlists are kept.","warning",true)
    status=="check-failed"->AccountPresentation("Unable to verify right now","The session is preserved. Check your connection and retry.","warning",true)
    status=="verified"->AccountPresentation("Signed in","Verified by the platform. Content and quality depend on account access.","check")
    else->AccountPresentation("Session connected · Not verified","The imported session must be verified to confirm it is valid.","shield")
}
