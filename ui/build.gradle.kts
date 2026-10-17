@file:OptIn(org.jetbrains.kotlin.gradle.ExperimentalWasmDsl::class)

import org.jetbrains.kotlin.gradle.targets.wasm.binaryen.BinaryenEnvSpec

plugins {
    kotlin("multiplatform")
    id("org.jetbrains.compose")
    id("org.jetbrains.kotlin.plugin.compose")
}

kotlin {
    wasmJs {
        browser { commonWebpackConfig { outputFileName = "tinglan-ui.js" } }
        binaries.executable()
        generateTypeScriptDefinitions()
    }
    sourceSets {
        commonMain {
            kotlin.srcDir("../shared/kotlin")
            kotlin.include("dev/tinglan/ui/**")
            kotlin.include("moe/rukamori/archivetune/ui/component/PlayerSlider.kt")
        }
        commonMain.dependencies {
            implementation(project(":core"))
            implementation("org.jetbrains.compose.runtime:runtime:1.12.1")
            implementation("org.jetbrains.compose.foundation:foundation:1.12.1")
            implementation("org.jetbrains.compose.material3:material3:1.9.0")
            implementation("org.jetbrains.compose.components:components-resources:1.12.1")
            implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")
        }
    }
}

compose.resources { packageOfResClass = "dev.tinglan.ui.generated.resources" }

providers.gradleProperty("tinglan.binaryen.path").orNull?.let { optimizer ->
    extensions.configure<BinaryenEnvSpec> { download.set(false); command.set(optimizer) }
}
