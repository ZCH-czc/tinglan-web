package dev.tinglan.core

import kotlin.test.*

class SettingsCatalogTest {
    @Test fun englishAndFullWidthSearchUseActualDestinations(){assertTrue(SettingsCatalog.search("ＱＱ sign in").any {it.id=="accounts"});assertEquals(listOf("sound"),SettingsCatalog.search("USB headphones").map {it.id});assertEquals(listOf("restore"),SettingsCatalog.search("restore backup").map {it.id})}
    @Test fun blankAndMissingQueriesHavePredictableResults(){assertEquals(SettingsCatalog.entries,SettingsCatalog.search("　 "));assertTrue(SettingsCatalog.search("完全不存在的设置").isEmpty());assertEquals(23,SettingsCatalog.entries.map {it.id}.toSet().size)}
    @Test fun accountLoadFailureIsDistinctFromDisconnected(){assertEquals("Status not loaded",accountPresentation(false,false,"disconnected").title);assertEquals("Not signed in",accountPresentation(true,false,"disconnected").title)}
    @Test fun expiredOrFailedStatusCannotBeHiddenByAConnectedSession(){assertTrue(accountPresentation(true,true,"expired").attention);assertEquals("Unable to verify right now",accountPresentation(true,true,"check-failed").title);assertTrue(accountPresentation(true,true,"check-failed").detail.contains("preserved"))}
    @Test fun onlyVerifiedSessionsClaimLoggedIn(){assertEquals("Signed in",accountPresentation(true,true,"verified").title);assertTrue(accountPresentation(true,true,"unverified").title.contains("Not verified"));assertTrue(accountPresentation(true,true,"unknown").title.contains("Not verified"));assertEquals("Verifying",accountPresentation(true,true,"expired",true).title)}
}
