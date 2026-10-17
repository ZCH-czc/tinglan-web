// The Pages packager changes only its output copy; local builds keep the companion.
export const DEPLOYMENT = 'companion';
export const STATIC_HOSTING = DEPLOYMENT === 'static';
export const applicationBase = new URL('./', import.meta.url);
export const deploymentScope = encodeURIComponent(applicationBase.pathname);
export const companionMessage = 'This is the GitHub Pages local music edition. Platform search, sign-in, video, and live streams require the Tinglan companion on your computer. Open its local URL to use them.';

export function requireCompanion(staticHosting = STATIC_HOSTING) {
  if (staticHosting) throw Object.assign(new Error(companionMessage), {
    code: 'companion-required', status: 503,
  });
}

export function storageName(name, {staticHosting = STATIC_HOSTING, scope = deploymentScope} = {}) {
  return staticHosting ? `${name}:${scope}` : name;
}
