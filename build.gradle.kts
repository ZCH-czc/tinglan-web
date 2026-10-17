plugins {
    kotlin("multiplatform") version "2.4.10" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.4.10" apply false
    id("org.jetbrains.compose") version "1.12.1" apply false
}

val buildBrowserWorkers = tasks.register<Exec>("buildBrowserWorkers") {
    dependsOn(":ui:wasmJsProductionExecutableCompileSync")
    commandLine(providers.gradleProperty("tinglan.node.path").orElse("node").get(), "scripts/build-web.mjs")
    inputs.files("package.json", "package-lock.json", "scripts/build-web.mjs")
    inputs.files("web/metadata-worker.mjs", "web/metadata-parse.mjs")
    inputs.dir("web")
    inputs.files("web/hls-adapter.mjs", "web/login-qr.mjs")
    inputs.files("vendor/netease-recognition/afp.wasm", "vendor/netease-recognition/afp-bindings.js", "vendor/netease-recognition/NOTICE.txt")
    inputs.dir("web/licenses")
    inputs.file("web/Noto-Sans-SC-OFL.txt")
    inputs.dir(project(":ui").layout.buildDirectory.dir("compileSync/wasmJs/main/productionExecutable/kotlin"))
    inputs.dir(project(":ui").layout.buildDirectory.dir("compose/skiko-runtime-processed-wasmjs"))
    outputs.dir(layout.buildDirectory.dir("browser"))
}

val prepareWebDistribution = tasks.register<Sync>("prepareWebDistribution") {
    dependsOn(":core:wasmJsProductionExecutableCompileSync")
    dependsOn(buildBrowserWorkers)
    from(project(":core").layout.buildDirectory.dir("compileSync/wasmJs/main/productionExecutable/kotlin")) {
        into("engine")
    }
    from(layout.projectDirectory.dir("web")) { exclude("metadata-worker.mjs", "metadata-parse.mjs", "hls-adapter.mjs", "login-qr.mjs", "local-index-worker.mjs") }
    from(layout.buildDirectory.dir("browser"))
    from(project(":ui").layout.buildDirectory.dir("processedResources/wasmJs/main"))
    from(layout.projectDirectory.file("LICENSE")) { rename { "LICENSE.txt" } }
    from(layout.projectDirectory.file("NOTICE")) { rename { "NOTICE.txt" } }
    into(layout.buildDirectory.dir("package"))
}
tasks.register<Exec>("webDistribution") {
    dependsOn(prepareWebDistribution)
    commandLine(providers.gradleProperty("tinglan.node.path").orElse("node").get(), "scripts/optimize-web.mjs")
    inputs.dir(layout.buildDirectory.dir("package"))
    inputs.file("scripts/optimize-web.mjs")
    outputs.dir(layout.buildDirectory.dir("dist"))
}

// Package the same client for static hosting after all regular build inputs exist.
tasks.register<Exec>("pagesDistribution") {
    dependsOn("webDistribution")
    commandLine(providers.gradleProperty("tinglan.node.path").orElse("node").get(), "scripts/prepare-pages.mjs")
    inputs.dir(layout.buildDirectory.dir("package"))
    inputs.files("scripts/prepare-pages.mjs", "scripts/optimize-web.mjs", "scripts/verify-distribution.mjs")
    outputs.dir(layout.buildDirectory.dir("pages"))
}
