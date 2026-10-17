# Security

Do not post account credentials, cookies, login QR challenges, private media,
or access tokens in issues. For a suspected vulnerability, use GitHub's private
vulnerability reporting when available, or contact the repository owner
privately without including secrets in the initial report.

The bundled Node.js companion is designed for a single user's loopback address.
It is not a hardened, multi-user public service. Its session checks, platform
allowlists, request limits, and media relay ownership must remain intact.

The GitHub Pages build has no companion credentials and sends no authentication
requests to GitHub. Do not add arbitrary public proxies or disable TLS checks
to make restricted platform requests appear to work.

The PWA stores imported media on the current browser origin. Its backup format
excludes account sessions. Clearing browser storage removes locally held music;
the app offers backup and restore for portability.

