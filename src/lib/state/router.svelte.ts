// Minimal path router: the share target posts to /share-target and redirects
// to /send, and notifications open /receive, so real paths (not hashes) are
// required. Netlify's SPA fallback serves index.html for all of them.

export type Route =
  'home' | 'send' | 'receive' | 'settings' | 'people' | 'privacy' | 'terms' | 'notfound';

const routes: Record<string, Route> = {
  '/': 'home',
  '/send': 'send',
  '/receive': 'receive',
  '/settings': 'settings',
  '/people': 'people',
  // Contact invite links (QR codes): /add?invite=… (not ?code=, which supabase-js
  // would try to exchange as an OAuth code)
  '/add': 'people',
  '/privacy': 'privacy',
  '/terms': 'terms',
};

function parse(): { route: Route; query: URLSearchParams } {
  return {
    route: routes[location.pathname] ?? 'notfound',
    query: new URLSearchParams(location.search),
  };
}

export const router = $state(parse());

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  if (to === location.pathname + location.search) return;
  if (opts.replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  Object.assign(router, parse());
  window.scrollTo(0, 0);
}

window.addEventListener('popstate', () => Object.assign(router, parse()));

/** Intercept same-origin <a href="/..."> clicks so links don't reload the page. */
export function handleLinkClick(event: MouseEvent): void {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey
  )
    return;
  const a = (event.target as Element | null)?.closest('a');
  if (!a || a.target || a.hasAttribute('download') || a.origin !== location.origin) return;
  if (!(a.pathname in routes)) return;
  event.preventDefault();
  navigate(a.pathname + a.search);
}
