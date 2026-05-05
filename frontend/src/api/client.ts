type SlugGetter = () => string;
type TokenGetter = () => string | null;

let slugGetter: SlugGetter = () => '';
let tokenGetter: TokenGetter = () => null;

export function configureApiClient(getSlug: SlugGetter, getToken: TokenGetter): void {
  slugGetter = getSlug;
  tokenGetter = getToken;
}

function isOurApiRequest(input: RequestInfo | URL): boolean {
  if (typeof input === 'string') return input.startsWith('/api');
  if (input instanceof URL) return input.pathname.startsWith('/api');
  return input.url.startsWith('/api');
}

/** Adds `X-Store-Slug` and `Authorization` for same-origin `/api/*` requests. */
export function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!isOurApiRequest(input)) {
    return fetch(input, init);
  }
  const headers = new Headers(init?.headers);
  const slug = slugGetter();
  if (slug) headers.set('X-Store-Slug', slug);
  const token = tokenGetter();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

/** `/api/platform/*`：只带 Token，不带店铺头 */
export function platformApiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const token = tokenGetter();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
