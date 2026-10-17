package dev.tinglan.core

data class LocalPlaylist(val id: String, val name: String, val trackIds: List<String>, val createdAt: Long)

/** Membership rules shared by browser persistence and queue selection. */
class PlaylistCatalog(private val trackExists: (String) -> Boolean) {
    private val entries = linkedMapOf<String, LocalPlaylist>()

    fun upsert(id: String, name: String, ids: List<String>, createdAt: Double): Boolean {
        if (id.isBlank() || id.length > 200 || name.isBlank() || name.trim().length > 80) return false
        if (id !in entries && entries.size >= 200) return false
        if (ids.size > 10_000 || ids.distinct().size != ids.size || ids.any { !trackExists(it) }) return false
        val timestamp = if (createdAt.isFinite()) createdAt.coerceIn(0.0, 9_007_199_254_740_991.0).toLong() else 0
        entries[id] = LocalPlaylist(id, name.trim(), ids.toList(), timestamp)
        return true
    }

    fun add(id: String, trackId: String): Boolean {
        val playlist = entries[id] ?: return false
        if (!trackExists(trackId)) return false
        if (trackId !in playlist.trackIds) entries[id] = playlist.copy(trackIds = playlist.trackIds + trackId)
        return true
    }

    fun removeSong(id: String, trackId: String): Boolean {
        val playlist = entries[id] ?: return false
        entries[id] = playlist.copy(trackIds = playlist.trackIds.filterNot { it == trackId })
        return true
    }

    fun removeTrack(trackId: String) {
        entries.keys.toList().forEach { removeSong(it, trackId) }
    }

    fun remove(id: String): Boolean = entries.remove(id) != null
    fun get(id: String): LocalPlaylist? = entries[id]
    fun all(): List<LocalPlaylist> = entries.values.sortedByDescending { it.createdAt }
}
