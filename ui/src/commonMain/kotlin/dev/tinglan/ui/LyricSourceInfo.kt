package dev.tinglan.ui

import androidx.compose.runtime.Immutable

@Immutable data class LyricSourceInfo(val id:String="",val title:String="",val artist:String="",val duration:Long=0,val provider:String="platform",val adjusted:Boolean=false,val loading:Boolean=false,val error:String="",val notice:String="")
