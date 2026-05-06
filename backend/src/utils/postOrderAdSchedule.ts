import { createAppError } from '../middleware/errorHandler';

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export function assertYmd(s: string, field: string): void {
  if (!YMD_RE.test(s)) {
    throw createAppError('VALIDATION_ERROR', `${field} 须为 YYYY-MM-DD`);
  }
}

export function assertYmdOrder(from: string, to: string): void {
  if (from > to) {
    throw createAppError('VALIDATION_ERROR', 'validFrom 不能晚于 validTo');
  }
}

const HM_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function parseHmToMinutes(s: string): number | null {
  const m = HM_RE.exec(s.trim());
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/** 允许相对路径（本站图）或 http(s) */
export function assertSafeImageUrl(url: string): void {
  const t = url.trim();
  if (!t) throw createAppError('VALIDATION_ERROR', 'imageUrl 必填');
  if (t.startsWith('/')) return;
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    throw createAppError('VALIDATION_ERROR', 'imageUrl 无效');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw createAppError('VALIDATION_ERROR', 'imageUrl 仅支持 http(s) 或以 / 开头的站内路径');
  }
}

export function assertSafeLinkUrl(url: string): void {
  const t = url.trim();
  if (!t) throw createAppError('VALIDATION_ERROR', 'linkUrl 必填');
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    throw createAppError('VALIDATION_ERROR', 'linkUrl 须为完整 URL（含 https://）');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw createAppError('VALIDATION_ERROR', 'linkUrl 仅支持 http(s)');
  }
}

export function ymdInTimeZone(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function minutesNowInTimeZone(d: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);
  return hour * 60 + minute;
}

export type PostOrderAdScheduleFields = {
  validFrom: string;
  validTo: string;
  windowStart?: string;
  windowEnd?: string;
};

export type PostOrderAdCapFields = PostOrderAdScheduleFields & {
  impressionCount?: number;
  clickCount?: number;
  maxImpressions?: number | null;
  maxClicks?: number | null;
};

/** 展示/点击上限（与日期、每日时段独立；未设置上限则不计入停止条件） */
export function isPostOrderAdWithinNumericCaps(
  ad: Pick<PostOrderAdCapFields, 'impressionCount' | 'clickCount' | 'maxImpressions' | 'maxClicks'>,
): boolean {
  const maxI = ad.maxImpressions;
  if (maxI != null && maxI > 0 && (ad.impressionCount ?? 0) >= maxI) {
    return false;
  }
  const maxC = ad.maxClicks;
  if (maxC != null && maxC > 0 && (ad.clickCount ?? 0) >= maxC) {
    return false;
  }
  return true;
}

export function parseOptionalMaxCap(raw: unknown, fieldLabel: string): number | null {
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 1 || Math.floor(n) !== n) {
    throw createAppError('VALIDATION_ERROR', `${fieldLabel} 须为正整数或留空（不限制）`);
  }
  return n;
}

/** 当前计数已达展示/点击上限时自动停用（用于保存后或增量上报后） */
export function applyPostOrderAdAutoDeactivateFromCaps(doc: {
  get(path: string): unknown;
  set(path: string, v: unknown): void;
}): void {
  if (doc.get('isActive') === false) return;
  const imp = Number(doc.get('impressionCount')) || 0;
  const clk = Number(doc.get('clickCount')) || 0;
  const maxI = doc.get('maxImpressions') as number | null | undefined;
  const maxC = doc.get('maxClicks') as number | null | undefined;
  if (maxI != null && maxI > 0 && imp >= maxI) {
    doc.set('isActive', false);
    return;
  }
  if (maxC != null && maxC > 0 && clk >= maxC) {
    doc.set('isActive', false);
  }
}

export function isPostOrderAdActiveNow(
  ad: PostOrderAdScheduleFields,
  now: Date,
  timeZone: string,
): boolean {
  const today = ymdInTimeZone(now, timeZone);
  if (today < ad.validFrom || today > ad.validTo) {
    return false;
  }
  const ws = (ad.windowStart || '').trim();
  const we = (ad.windowEnd || '').trim();
  if (!ws || !we) {
    return true;
  }
  const startM = parseHmToMinutes(ws);
  const endM = parseHmToMinutes(we);
  if (startM === null || endM === null) {
    return true;
  }
  const mins = minutesNowInTimeZone(now, timeZone);
  if (startM <= endM) {
    return mins >= startM && mins <= endM;
  }
  return mins >= startM || mins <= endM;
}

export function filterActivePostOrderAds<T extends PostOrderAdCapFields>(
  ads: T[],
  now = new Date(),
  timeZone = process.env.PLATFORM_AD_TIMEZONE || 'Asia/Hong_Kong',
): T[] {
  return ads.filter(
    (a) => isPostOrderAdActiveNow(a, now, timeZone) && isPostOrderAdWithinNumericCaps(a),
  );
}
