# Contributing

Use English for issues, pull requests, documentation, and explanatory code
comments. Preserve existing user-facing translations and third-party notices.

## Development

1. Install JDK 21 and Node.js 22 or later.
2. Run `npm ci` to install the locked dependency tree.
3. Build with `./gradlew :core:jvmTest webDistribution`.
4. Run `npm test` and `npm run serve`.
5. For hosting changes, also run `./gradlew pagesDistribution` and
   `npm run preview:pages`.

Keep browser adapters separate from domain logic and UI rendering. Avoid
synchronous parsing, network access, or persistent storage writes in animation
frames. Coalesce duplicate requests, cancel obsolete operations, and preserve
the user's pause intent through retries and navigation.

Tests should cover behavior and meaningful failure modes. Never use real
account cookies, personal media, or account identifiers as test fixtures. Build
artifacts and developer-specific configuration do not belong in source control.

## Release checks

- Run the JVM and JavaScript suites against a fresh build.
- Verify all distribution asset hashes and WebAssembly binaries.
- Check both local-companion and static project-subdirectory deployment.
- Check phone and desktop layouts, local playback, and offline reopening.
- Update `package.json`, the lockfile, visible version strings, and release notes
  together when changing application behavior.
- Keep the deployment artifact limited to `build/pages/`.

Pages deployment uses GitHub's environment-scoped deployment token. Do not add
personal access tokens, platform account secrets, or signing keys to workflows.

