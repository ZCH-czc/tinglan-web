@file:OptIn(org.jetbrains.kotlin.gradle.ExperimentalWasmDsl::class)

import org.jetbrains.kotlin.gradle.ExperimentalWasmDsl
import org.jetbrains.kotlin.gradle.targets.wasm.binaryen.BinaryenEnvSpec

plugins { kotlin("multiplatform") }

kotlin {
    jvm()
    @OptIn(ExperimentalWasmDsl::class)
    wasmJs {
        browser()
        binaries.executable()
        generateTypeScriptDefinitions()
        compilerOptions { freeCompilerArgs.add("-Xwasm-enable-array-range-checks") }
    }

    sourceSets {
        commonMain {
            // Compile the attributed, platform-free policy snapshot for JVM and Wasm.
            kotlin.srcDir("../shared/kotlin")
            kotlin.include("dev/tinglan/core/**")
            kotlin.include("moe/rukamori/archivetune/ui/component/PlayingIndicatorMotion.kt")
            kotlin.include("moe/rukamori/archivetune/lyrics/LyricsRefreshPolicy.kt")
            kotlin.include("moe/rukamori/archivetune/lyrics/LyricsLineInteraction.kt")
            kotlin.include("moe/rukamori/archivetune/musicrecognition/LocalAudioFingerprint.kt")
            kotlin.include("moe/rukamori/archivetune/ui/player/QueueViewport.kt")
        }
        commonTest.dependencies { implementation(kotlin("test")) }
    }
}

// Optional existing optimizer for restricted development networks; normal builds
// download the pinned official tool through the Kotlin Gradle plugin.
providers.gradleProperty("tinglan.binaryen.path").orNull?.let { optimizer ->
    extensions.configure<BinaryenEnvSpec> {
        download.set(false)
        command.set(optimizer)
    }
}
