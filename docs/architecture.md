# Architecture

## Ownership boundaries

The Kotlin core owns queue semantics, lyrics timing, local indexing policies,
and other platform-independent decisions. Compose owns visible layouts and
interaction rendering. JavaScript adapters own browser media elements, storage,
workers, service-worker lifecycle, and platform transport.

The Node companion normalizes online platform responses. Browser code never
assumes that public platform endpoints allow direct CORS requests. Platform
sessions are ephemeral, checked against their owner, and excluded from backups.

## Static hosting

`web/deployment.mjs` identifies the deployment mode. Normal builds use
`companion`; the Pages packaging step switches only the packaged copy to
`static`, then computes new resource hashes and a service-worker build identity.

Static mode uses the existing local-media screens, removes online discovery
from the home page, and searches the imported library. Calls that require a
companion fail immediately with an actionable explanation before any request
is sent. Imported local audio, the player, playlists, lyrics, and backup use
the same domain implementation in both builds.

## Lifecycle and performance

Media decoding belongs to browser media elements. Metadata and expensive file
operations run in workers. UI snapshots retain unchanged collections instead
of serializing the full library every frame. Obsolete loads are cancelled and
old network replies cannot take ownership of a new playback session.

Service-worker application caches are separate from user media storage. A new
build stays waiting until the user accepts it; active transfers block an update.
Scoped cache names prevent one Pages project from deleting another project's
application cache on the same origin.

