import { useState, useEffect } from 'react';
import i18n from '../i18n';

export interface RestaurantConfig {
  restaurant_name_zh?: string;
  restaurant_name_en?: string;
  restaurant_address?: string;
  restaurant_phone?: string;
  restaurant_logo?: string;
  restaurant_website?: string;
  restaurant_email?: string;
  receipt_terms?: string;
  receipt_print_copies?: string;
}

let cachedConfig: RestaurantConfig | null = null;
let fetchPromise: Promise<RestaurantConfig> | null = null;

/** Single restaurant name for the tab, matching UI language with sensible fallback. */
function pickDocumentTitleName(cfg: RestaurantConfig): string {
  const zh = cfg.restaurant_name_zh?.trim();
  const en = cfg.restaurant_name_en?.trim();
  const wantsZh = (i18n.language || 'en-US').startsWith('zh');
  if (wantsZh) return zh || en || '';
  return en || zh || '';
}

function applyDocumentTitle(cfg: RestaurantConfig) {
  const title = pickDocumentTitleName(cfg);
  if (title) document.title = title;
}

i18n.on('languageChanged', () => {
  if (cachedConfig) applyDocumentTitle(cachedConfig);
});

function fetchConfig(): Promise<RestaurantConfig> {
  if (cachedConfig) return Promise.resolve(cachedConfig);
  if (fetchPromise) return fetchPromise;
  fetchPromise = fetch('/api/admin/config')
    .then(r => r.ok ? r.json() : {})
    .then(data => {
      const cfg = (data || {}) as RestaurantConfig;
      cachedConfig = cfg;
      applyDocumentTitle(cfg);
      return cfg;
    })
    .catch(() => {
      const cfg = {} as RestaurantConfig;
      cachedConfig = cfg;
      return cfg;
    })
    .finally(() => {
      fetchPromise = null;
    });
  return fetchPromise;
}

/** Clear cached config (e.g. after admin updates) and refetch. */
export async function refreshRestaurantConfig(): Promise<RestaurantConfig> {
  cachedConfig = null;
  fetchPromise = null;
  const cfg = await fetchConfig();
  return cfg;
}

export function useRestaurantConfig() {
  const [config, setConfig] = useState<RestaurantConfig>(cachedConfig || {});

  useEffect(() => {
    fetchConfig().then(setConfig);
  }, []);

  const nameZh = config.restaurant_name_zh || '';
  const nameEn = config.restaurant_name_en || '';
  // Display name: prefer zh for Chinese contexts, en for English
  const displayName = nameZh || nameEn || '';
  const displayNameEn = nameEn || nameZh || '';

  return { config, displayName, displayNameEn, nameZh, nameEn };
}
