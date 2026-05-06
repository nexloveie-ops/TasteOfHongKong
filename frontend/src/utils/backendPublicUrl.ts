/**
 * 后端托管的静态路径（如 `/uploads/...`）。SPA 与 API 不同源时，构建前设置 `VITE_API_ORIGIN`
 *（例如 https://api.example.com，无尾斜杠），否则浏览器会把相对路径解析到当前页面域名导致 404。
 */
export function resolveBackendAssetUrl(url: string): string {
  if (!url || !url.startsWith('/')) return url;
  const raw = (import.meta.env.VITE_API_ORIGIN as string | undefined)?.trim() ?? '';
  const base = raw.replace(/\/$/, '');
  if (base) return `${base}${url}`;
  if (typeof window === 'undefined') return url;
  return `${window.location.origin}${url}`;
}
