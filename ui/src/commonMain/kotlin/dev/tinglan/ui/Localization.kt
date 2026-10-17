package dev.tinglan.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import dev.tinglan.core.InterfaceMessages
import kotlinx.serialization.json.*

internal var uiLanguage by mutableStateOf("en")
private var interfaceMessages=InterfaceMessages(emptyMap())

internal fun configureTranslations(language:String,raw:String) {
    if(raw.isNotEmpty())interfaceMessages=InterfaceMessages(Json.parseToJsonElement(raw).jsonObject.mapValues {it.value.jsonPrimitive.content})
    uiLanguage=if(language=="zh-CN")"zh-CN"else "en"
}

internal fun chineseText(key:String)=interfaceMessages.chineseText(key)
internal fun tr(key:String,vararg values:Any?)=interfaceMessages.text(uiLanguage,key,*values)
internal fun trMessage(value:String)=interfaceMessages.feedback(uiLanguage,value)
