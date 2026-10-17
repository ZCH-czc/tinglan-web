package dev.tinglan.core

import kotlin.math.ceil
import kotlin.math.min

data class TimedDanmaku(val at: Long, val text: String, val mode: Int = 1, val color: Int = 0xffffff)
data class DanmakuOptions(val fontPixels: Float = 22f, val area: Float = .5f, val speed: Float = 1f, val density: Int = 16, val blocked: List<String> = emptyList())
data class PlacedDanmaku(val item: TimedDanmaku, val x: Float, val y: Float, val maxWidth: Float)

/** A bounded lane planner. No font layout or complete-list traversal occurs on normal frames. */
class DanmakuPlanner {
    private data class Actor(val item: TimedDanmaku, val lane: Int, val width: Float, val end: Long)
    private var data: List<TimedDanmaku>? = null
    private var options: DanmakuOptions? = null
    private var width = 0f
    private var height = 0f
    private var index = 0
    private var previous = -1L
    private var free = LongArray(0)
    private val actors = mutableListOf<Actor>()

    fun layout(items: List<TimedDanmaku>, at: Long, w: Float, h: Float, input: DanmakuOptions): List<PlacedDanmaku> {
        if(w <= 0 || h <= 0 || at < 0) return emptyList()
        val line = input.fontPixels.coerceIn(12f, 144f) * 1.4f
        val rows = (h * input.area.coerceIn(.25f,.85f) / line).toInt().coerceIn(1,24)
        val velocity = w * input.speed.coerceIn(.5f,2f) / 8f
        if(data !== items || options != input || width != w || height != h || at < previous || at - previous > 3000) {
            data=items; options=input; width=w; height=h; free=LongArray(rows); actors.clear()
            var low=0; var high=items.size
            while(low<high) {val mid=(low+high)/2;if(items[mid].at<at-40_000)low=mid+1 else high=mid}
            index=low
        }
        actors.removeAll { it.end <= at }
        val density=input.density.coerceIn(4,24)
        while(index<items.size && items[index].at<=at) {
            val item=items[index++];if(item.text.isBlank() || input.blocked.any {it.isNotBlank() && item.text.contains(it,ignoreCase=true)})continue
            val messageWidth=min(w*1.5f,item.text.length*input.fontPixels.coerceIn(12f,144f)*1.05f)
            val lifetime=if(item.mode==1)ceil((w+messageWidth)/velocity*1000).toLong() else 4000L
            if(item.at+lifetime<=at || actors.size>=density)continue
            fun available(row:Int)=free[row]<=item.at && (item.mode==1 || actors.none {it.lane==row})
            val lane=if(item.mode==4)free.indices.reversed().firstOrNull(::available) else free.indices.firstOrNull(::available)
            if(lane==null)continue
            free[lane]=item.at+if(item.mode==1)ceil((messageWidth+32f)/velocity*1000).toLong() else lifetime
            actors.add(Actor(item,lane,messageWidth,item.at+lifetime))
        }
        previous=at
        return actors.map { actor ->
            val x=if(actor.item.mode==1)w-(at-actor.item.at)/1000f*velocity else (w-actor.width)/2
            val y=if(actor.item.mode==4)h-(rows-actor.lane)*line else actor.lane*line
            PlacedDanmaku(actor.item,x.coerceAtLeast(-actor.width),y.coerceAtLeast(0f),w*1.5f)
        }
    }
}
