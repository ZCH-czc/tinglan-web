package dev.tinglan.core

import kotlin.test.*

class InterfaceMessagesTest {
    private val catalog=InterfaceMessages(mapOf("Home" to "首页","Imported {0} tracks: {1}" to "已导入 {0} 首歌曲：{1}","Page {0} of {1}" to "共 {1} 页，第 {0} 页"))
    @Test fun defaultsAndMissingKeysPreserveEnglish(){assertEquals("Home",catalog.text("en","Home"));assertEquals("Unknown",catalog.text("zh-CN","Unknown"))}
    @Test fun interpolatedContentIsNeverTranslated(){assertEquals("已导入 1 首歌曲：Home {0}",catalog.text("zh-CN","Imported {0} tracks: {1}",1,"Home {0}"));assertEquals("共 8 页，第 2 页",catalog.text("zh-CN","Page {0} of {1}",2,8))}
    @Test fun retainedFeedbackFollowsBothLanguageDirections(){val en="Imported 1 tracks: 海风 / Home";val zh="已导入 1 首歌曲：海风 / Home";repeat(50){assertEquals(zh,catalog.feedback("zh-CN",en));assertEquals(en,catalog.feedback("en",zh))};assertEquals("Home",catalog.feedback("en","首页"))}
    @Test fun unknownFeedbackAndLiteralPlaceholderValuesAreSafe(){assertEquals("A platform-specific error",catalog.feedback("zh-CN","A platform-specific error"));assertEquals("已导入 1 首歌曲：{0}",catalog.text("zh-CN","Imported {0} tracks: {1}",1,"{0}"))}
}
