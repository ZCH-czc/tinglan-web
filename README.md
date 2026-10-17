# Tinglan Web

[Open the Web app](https://zch-czc.github.io/tinglan-web/) · [Build and deployment](https://github.com/ZCH-czc/tinglan-web/actions/workflows/pages.yml)

A local-first music application built with Kotlin/Wasm, Compose Multiplatform,
and Skia. Its interface includes a music library, playlists, synchronized lyrics,
playback queue, offline storage, and optional online platform integrations.

This is the standalone Web source repository. It builds independently of the
Android application. The application interface, repository documentation, and contribution
instructions are in English. Music titles, lyrics, and platform content retain
their original language.

## Two deployment modes

| Capability | GitHub Pages | Local companion |
| --- | --- | --- |
| Import and play local music | Yes | Yes |
| Playlists, favorites, queue, lyrics editing | Yes | Yes |
| Browser storage, backup and restore | Yes | Yes |
| Installable PWA and offline application assets | Supported by the browser | Supported by the browser |
| QQ Music, Bilibili, NetEase search and account sessions | Requires the companion | Yes, subject to platform access |
| Online video, live streams, online lyrics and downloads | Requires the companion | Yes, subject to platform access |
| Android widgets, OPPO services, native live notifications | No | No |

**GitHub Pages serves static files; it does not run the Node.js companion.**
The public build opens in local-library mode, does not submit account requests
to GitHub, and explains which features require a local service. It is not a
public media proxy. To use online integrations, run the companion and open its
own local address. See [deployment](docs/deployment.md).

## Requirements

- JDK 21
- Node.js 22 or later; Node.js 24 is used in CI
- A current browser with WebAssembly GC support
- Network access for the first dependency download

Gradle, Kotlin, Compose, npm dependencies, and the Wasm optimizer are pinned.
The Gradle wrapper verifies its distribution checksum. No global Gradle install
is required.

## Run locally

```sh
npm ci
./gradlew :core:jvmTest webDistribution
npm test
npm run serve
```

On Windows, use `gradlew.bat` instead of `./gradlew`. Open
**http://127.0.0.1:4173/**. Keep the same hostname and port when reopening the app;
browser storage and account sessions are scoped to that origin.

The companion binds only to `127.0.0.1`. Do not expose it directly to the public
internet. Credentials remain in the local companion's in-memory session and
are not included in repository files, browser backups, or published artifacts.

## Build the GitHub Pages application

```sh
npm ci
./gradlew webDistribution pagesDistribution
node scripts/verify-distribution.mjs build/pages
npm run preview:pages
```

Open **http://127.0.0.1:4175/tinglan-web/** to check project-subdirectory hosting.
`build/dist/` is the local-companion build. `build/pages/` is the static build.
Never publish the source tree, `server/`, local sessions, or development caches
as a Pages artifact.

The [Pages workflow](.github/workflows/pages.yml) builds from source, runs the
JavaScript and JVM tests, verifies the Wasm files and asset hashes, then uploads
only `build/pages/`. Select **GitHub Actions** in the repository's **Settings →
Pages → Build and deployment** panel. A push to `main` deploys a verified build.

## Architecture

| Directory | Responsibility |
| --- | --- |
| `core/` | Platform-independent Kotlin domain logic and Wasm exports |
| `ui/` | Compose/Skia interface, player, lyrics, dialogs, and responsive layouts |
| `shared/kotlin/` | Attributed platform-free policies shared with ArchiveTune |
| `web/` | Browser adapters, playback, workers, storage, navigation, and PWA |
| `server/` | Optional local platform gateway and session management |
| `scripts/` | Reproducible build, verification, and preview commands |
| `tests/` | JavaScript behavior and integration tests |
| `vendor/` | Pinned recognition engine with its original provenance notice |

Visible application controls are drawn by Compose/Skia. Browser facilities are
used for media decoding, file selection, the clipboard, input methods, and
operating-system media controls. Video uses the browser decoder; the app does
not claim to force hardware acceleration or bypass platform permissions.

## Data and updates

Music files are stored locally in IndexedDB after import. Nothing is uploaded
to GitHub. Export a backup before clearing browser data or changing origins.
Browser storage may be evicted by the device. PWA installation and background
download support vary by browser; a terminated browser cannot be assumed to
continue a download.

The service worker caches a complete application build. Updates are offered
with an explicit confirmation instead of replacing a playing session. The
static deployment uses application-path-scoped caches and library storage so
other Pages applications on the same domain remain independent.

## Contributing and license

Read [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and
[the architecture notes](docs/architecture.md) before making changes.

Tinglan Web is distributed under **GPL-3.0**. Shared policies originate in
ArchiveTune by Rukamori and contributors. Existing copyright notices are
preserved. Third-party components retain their own licenses; see [NOTICE](NOTICE),
[LICENSE](LICENSE), and the notices shipped with the built application.

The clean source export is recorded in [provenance](docs/provenance.json).
This repository contains no private Android history, signing material, account
sessions, or user music.

