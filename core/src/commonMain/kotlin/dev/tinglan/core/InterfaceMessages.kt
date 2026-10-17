package dev.tinglan.core

/** Interface templates only. Interpolated titles, lyrics and other user text stay opaque. */
class InterfaceMessages(private val chinese:Map<String,String>) {
    private val slots=Regex("\\{(\\d+)\\}")
    private val english=chinese.entries.associate {it.value to it.key}
    private data class Pattern(val match:Regex,val target:String,val slots:List<Int>)
    private val toChinese=patterns(chinese)
    private val toEnglish=patterns(english)
    private val feedbackCache=linkedMapOf<Pair<String,String>,String>()

    fun chineseText(key:String)=chinese[key] ?: key
    fun text(language:String,key:String,vararg values:Any?):String {
        val pattern=if(language=="zh-CN")chineseText(key)else key
        return if(values.isEmpty())pattern else slots.replace(pattern) {m->
            val index=m.groupValues[1].toInt()
            if(index<values.size)values[index]?.toString().orEmpty()else m.value
        }
    }

    /** Translate application feedback retained across a language change, never media content. */
    fun feedback(language:String,value:String):String {
        if(value.isEmpty())return value
        val map=if(language=="zh-CN")chinese else english
        map[value]?.let {return it}
        val key=language to value
        feedbackCache[key]?.let {return it}
        val candidates=if(language=="zh-CN")toChinese else toEnglish
        val result=candidates.firstNotNullOfOrNull {template->
            val match=template.match.matchEntire(value) ?: return@firstNotNullOfOrNull null
            val values=template.slots.mapIndexed {index,slot->slot to match.groupValues[index+1]}.toMap()
            slots.replace(template.target) {m->values[m.groupValues[1].toInt()] ?: m.value}
        } ?: value
        feedbackCache[key]=result
        while(feedbackCache.size>128)feedbackCache.remove(feedbackCache.keys.first())
        return result
    }

    private fun patterns(messages:Map<String,String>)=messages.mapNotNull {(source,target)->
        val matches=slots.findAll(source).toList()
        if(matches.isEmpty() || slots.replace(source,"").length<4)return@mapNotNull null
        var cursor=0
        val regex=buildString {
            append("^")
            matches.forEach {m->append(Regex.escape(source.substring(cursor,m.range.first)));append("([\\s\\S]*?)");cursor=m.range.last+1}
            append(Regex.escape(source.substring(cursor)));append("$")
        }
        Pattern(Regex(regex),target,matches.map {it.groupValues[1].toInt()})
    }
}
