type SlugGetter = () => string;
type TokenGetter = () => string | null;

let slugGetter: SlugGetter = () => '';
let tokenGetter: TokenGetter = () => null;

export function configureApiClient(getSlug: SlugGetter, getToken: TokenGetter): void {
  slugGetter = getSlug;
  tokenGetter = getToken;
}

/** 与 `VITE_API_ORIGIN` 一致：开发时若 Vite 代理异常，可设为 `http://127.0.0.1:8080` 直连后端 */
function getApiOrigin(): string {
  return (import.meta.env.VITE_API_ORIGIN as string | undefined)?.trim().replace(/\/$/, '') ?? '';
}

/**
 * 将相对路径 `/api/...` 解析为完整 URL（配置了 `VITE_API_ORIGIN` 时）。
 * 若 `VITE_API_ORIGIN` 指向前端自身（与 `window.location` 同 host），则仍用相对路径，
 * 以便 Vite dev/preview 的 proxy 把请求转到后端；误配为 `http://localhost:5173` 时常见 404。
 */
export function resolveApiUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const origin = getApiOrigin();
  if (origin && path.startsWith('/api')) {
    if (typeof window !== 'undefined') {
      try {
        const apiOrigin = new URL(origin.endsWith('/') ? origin.slice(0, -1) : origin);
        const pageOrigin = new URL(window.location.href);
        if (apiOrigin.host === pageOrigin.host) {
          return path;
        }
      } catch {
        /* ignore */
      }
    }
    return `${origin}${path}`;
  }
  return path;
}

function isOurApiRequest(input: RequestInfo | URL): boolean {
  if (typeof input === 'string') return input.startsWith('/api');
  if (input instanceof URL) return input.pathname.startsWith('/api');
  return input.url.startsWith('/api');
}

export type StoreApiFetchInit = RequestInit & { /** 顾客端页面：勿带店员 JWT，否则会触发免 PIN 结账逻辑 */ omitStaffToken?: boolean };

/** Adds `X-Store-Slug` and `Authorization` for same-origin `/api/*` requests. */
export function apiFetch(input: RequestInfo | URL, init?: StoreApiFetchInit): Promise<Response> {
  if (!isOurApiRequest(input)) {
    return fetch(input, init);
  }
  const omitStaffToken = init?.omitStaffToken === true;
  const { omitStaffToken: _omit, ...restInit } = init ?? {};
  void _omit;
  const resolved =
    typeof input === 'string'
      ? resolveApiUrl(input)
      : input instanceof URL && input.pathname.startsWith('/api') && getApiOrigin()
        ? new URL(`${input.pathname}${input.search}${input.hash}`, getApiOrigin())
        : input;
  const headers = new Headers(restInit.headers);
  const slug = slugGetter();
  if (slug) headers.set('X-Store-Slug', slug);
  const token = tokenGetter();
  if (token && !omitStaffToken) headers.set('Authorization', `Bearer ${token}`);
  return fetch(resolved, { ...restInit, headers });
}

/** `/api/platform/*`：只带 Token，不带店铺头 */
export function platformApiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const token = tokenGetter();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const resolved =
    typeof input === 'string' && input.startsWith('/api')
      ? resolveApiUrl(input)
      : input instanceof URL && input.pathname.startsWith('/api') && getApiOrigin()
        ? new URL(`${input.pathname}${input.search}${input.hash}`, getApiOrigin())
        : input;
  return fetch(resolved, { ...init, headers });
}

/** 为会员接口附加 `storeSlug` 查询参数（相对 `/api/...` 或绝对 API URL） */
function withStoreSlugQuery(pathOrUrl: string, storeSlug: string): string {
  if (!storeSlug) return pathOrUrl;
  try {
    if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
      const u = new URL(pathOrUrl);
      if (!u.pathname.startsWith('/api/')) return pathOrUrl;
      if (!u.searchParams.has('storeSlug')) u.searchParams.set('storeSlug', storeSlug);
      return u.toString();
    }
    if (!pathOrUrl.startsWith('/api/')) return pathOrUrl;
    const qIndex = pathOrUrl.indexOf('?');
    const base = qIndex === -1 ? pathOrUrl : pathOrUrl.slice(0, qIndex);
    const search = qIndex === -1 ? '' : pathOrUrl.slice(qIndex + 1);
    const params = new URLSearchParams(search);
    if (!params.has('storeSlug')) params.set('storeSlug', storeSlug);
    const tail = params.toString();
    return tail ? `${base}?${tail}` : base;
  } catch {
    return pathOrUrl;
  }
}

/** 会员 JWT：不经过店员 AuthContext，由页面自行传入 token */
export function memberApiFetch(storeSlug: string, memberToken: string | null, input: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (storeSlug) headers.set('X-Store-Slug', storeSlug);
  if (memberToken) headers.set('Authorization', `Bearer ${memberToken}`);
  const url = resolveApiUrl(withStoreSlugQuery(input, storeSlug));
  return fetch(url, { ...init, headers });
}
