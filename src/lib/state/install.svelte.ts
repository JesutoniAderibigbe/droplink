// "Install app": Chrome/Edge fire beforeinstallprompt; Safari has no prompt,
// so we show instructions instead (Add to Dock on macOS, Add to Home Screen
// on iOS).

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const standalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as { standalone?: boolean }).standalone === true;

const ua = navigator.userAgent;
const isSafari = /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\/|CriOS|FxiOS/.test(ua);
const isIos = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);

export const install = $state<{
  installed: boolean;
  canPrompt: boolean;
  safari: 'mac' | 'ios' | null;
}>({
  installed: standalone(),
  canPrompt: false,
  safari: isSafari ? (isIos ? 'ios' : 'mac') : null,
});

let deferred: BeforeInstallPromptEvent | null = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // we show our own button instead of the mini-infobar
  deferred = e as BeforeInstallPromptEvent;
  install.canPrompt = true;
});

window.addEventListener('appinstalled', () => {
  install.installed = true;
  install.canPrompt = false;
  deferred = null;
});

export async function promptInstall(): Promise<void> {
  if (!deferred) return;
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  if (outcome === 'accepted') install.installed = true;
  deferred = null;
  install.canPrompt = false;
}
