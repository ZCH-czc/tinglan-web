# Deployment

## GitHub Pages

GitHub Pages hosts the compiled client only. Configure the publishing source
as **GitHub Actions**. The workflow builds and verifies the application before
deploying `build/pages/` through the official Pages actions.

Project URLs such as `https://OWNER.github.io/REPOSITORY/` are supported without
a hard-coded repository name. Application imports, fonts, worker registration,
the manifest, and asset caches resolve relative to that directory. Routes use
URL fragments, so deep links do not depend on server-side route rewriting.

The preview server mounts the static build at `/tinglan-web/` by default to
exercise subdirectory hosting. Set `BASE_PATH=/your-repository/` and `PORT=4175`
to test a different path. Only regular files beneath the build directory are
served. There is no API or platform proxy in this preview.

The first installation includes the Wasm runtime and bundled fonts, so it is
larger than a typical HTML application. The service worker preserves a complete
version for offline use. Optional font variants are loaded on demand. Pages
controls HTTP compression; precompressed files do not imply the server will
negotiate their content encoding.

## Local companion

Run `npm run serve` after `./gradlew webDistribution` and use its printed local
URL. The companion supplies online platform adapters and short-lived media
relay URLs. Authentication takes place locally and is subject to each platform's
permissions, account access, and network conditions.

Opening a Pages URL does not automatically connect it to a user's computer.
The current companion intentionally does not allow arbitrary cross-origin
access. To support remote deployments, design an authenticated HTTPS gateway
and its threat model first; do not open CORS or proxy permissions globally.

## Reproducibility

The repository contains the full Web sources and the small shared Kotlin policy
set required for the build. It does not depend on another private checkout.
`vendor/netease-recognition/NOTICE.txt` records the recognition asset provenance
and byte hashes. The build verifies those hashes before packaging.

CI runs on Linux. Windows developers can use the same wrapper with
`gradlew.bat`. The optional Gradle properties `tinglan.node.path` and
`tinglan.binaryen.path` allow explicitly installed tooling without committing
machine-specific paths.

