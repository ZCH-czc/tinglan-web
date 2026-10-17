package dev.tinglan.core

import kotlin.test.*

class DanmakuPlannerTest {
    @Test fun lanesRemainBoundedDuringDenseFramesAndSeeking() {
        val data=(0..3999).map {TimedDanmaku(it*20L,"弹幕 $it")}
        val planner=DanmakuPlanner();val options=DanmakuOptions(density=12)
        for(at in 0L..80_000L step 33) {
            val visible=planner.layout(data,at,640f,360f,options)
            assertTrue(visible.size<=12);assertTrue(visible.all {it.x.isFinite() && it.y>=0 && it.y<180f})
        }
        val seek=planner.layout(data,1000,640f,360f,options)
        assertTrue(seek.all {it.item.at<=1000});assertTrue(seek.isNotEmpty())
    }
    @Test fun speedResizeAndBlockRulesRebuildWithoutStaleMessages() {
        val data=listOf(TimedDanmaku(0,"keep"),TimedDanmaku(10,"blocked"),TimedDanmaku(20,"top",5))
        val planner=DanmakuPlanner();val old=planner.layout(data,1000,800f,500f,DanmakuOptions())
        val filtered=planner.layout(data,1000,400f,300f,DanmakuOptions(speed=2f,blocked=listOf("BLOCKED")))
        assertTrue(filtered.none {it.item.text=="blocked"});assertTrue(filtered.first().x<old.first().x)
        assertEquals(emptyList(),planner.layout(data,-1,400f,300f,DanmakuOptions()))
    }
    @Test fun scrollingMessagesInTheSameLaneKeepAVisibleGap() {
        val data=(0..50).map {TimedDanmaku(it*500L,"测试弹幕")};val options=DanmakuOptions(fontPixels=22f,density=24,area=.25f)
        val planner=DanmakuPlanner()
        for(at in 0L..25_000L step 50) {
            val rows=planner.layout(data,at,480f,120f,options).groupBy {it.y}
            for(messages in rows.values) {
                val sorted=messages.sortedBy {it.x}
                sorted.zipWithNext().forEach {(left,right)->assertTrue(right.x-left.x>=4*22f*1.05f+30f)}
            }
        }
    }
}
