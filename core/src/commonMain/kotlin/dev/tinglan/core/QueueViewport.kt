package dev.tinglan.core

/** Use the accepted Android list geometry, without negative leading space. */
fun queueCenterDelta(offset:Int,size:Int,start:Int,end:Int,before:Int,after:Int):Float =
    moe.rukamori.archivetune.ui.player.queueCenterScrollDelta(offset,size,start,end,before,after)

fun playingBarHeight(phase:Float,bar:Int):Float =
    moe.rukamori.archivetune.ui.component.PlayingIndicatorMotion.height(phase,bar)
