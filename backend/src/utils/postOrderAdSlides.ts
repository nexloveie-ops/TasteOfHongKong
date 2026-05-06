import { createAppError } from '../middleware/errorHandler';
import { assertSafeImageUrl } from './postOrderAdSchedule';

export type PostOrderSlide = {
  imageUrl: string;
  captionZh: string;
  captionEn: string;
};

export type PostOrderSlideInput = {
  imageUrl?: string;
  captionZh?: string;
  captionEn?: string;
};

/** 从库文档或请求体解析出展示用 slides（兼容仅含 imageUrl 的旧数据） */
export function getSlidesFromDoc(doc: {
  slides?: PostOrderSlideInput[] | null;
  imageUrl?: string | null;
}): PostOrderSlide[] {
  if (Array.isArray(doc.slides) && doc.slides.length > 0) {
    return doc.slides
      .filter((s) => s && typeof s.imageUrl === 'string' && s.imageUrl.trim())
      .map((s) => ({
        imageUrl: s.imageUrl!.trim(),
        captionZh: typeof s.captionZh === 'string' ? s.captionZh.trim() : '',
        captionEn: typeof s.captionEn === 'string' ? s.captionEn.trim() : '',
      }));
  }
  const legacy = typeof doc.imageUrl === 'string' ? doc.imageUrl.trim() : '';
  if (legacy) {
    return [{ imageUrl: legacy, captionZh: '', captionEn: '' }];
  }
  return [];
}

/** 从 POST/PATCH body 解析 slides；支持 legacy 单字段 imageUrl */
export function parseSlidesFromBody(b: Record<string, unknown>): PostOrderSlide[] {
  if (Array.isArray(b.slides)) {
    const out: PostOrderSlide[] = [];
    for (const raw of b.slides) {
      if (!raw || typeof raw !== 'object') continue;
      const o = raw as Record<string, unknown>;
      const imageUrl = typeof o.imageUrl === 'string' ? o.imageUrl.trim() : '';
      if (!imageUrl) continue;
      assertSafeImageUrl(imageUrl);
      out.push({
        imageUrl,
        captionZh: typeof o.captionZh === 'string' ? o.captionZh.trim() : '',
        captionEn: typeof o.captionEn === 'string' ? o.captionEn.trim() : '',
      });
    }
    return out;
  }
  const legacy = typeof b.imageUrl === 'string' ? b.imageUrl.trim() : '';
  if (legacy) {
    assertSafeImageUrl(legacy);
    return [{ imageUrl: legacy, captionZh: '', captionEn: '' }];
  }
  return [];
}

export function requireNonEmptySlides(slides: PostOrderSlide[]): void {
  if (slides.length === 0) {
    throw createAppError('VALIDATION_ERROR', '至少保留一张图片（上传至存储桶或填写图片 URL）');
  }
}
