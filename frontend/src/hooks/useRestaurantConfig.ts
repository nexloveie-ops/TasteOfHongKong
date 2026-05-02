import { useState, useEffect } from 'react';

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

function fetchConfig(): Promise<RestaurantConfig> {
  if (cachedConfig) return Promise.resolve(cachedConfig);
  if (fetchPromise) return fetchPromise;
  fetchPromise = fetch('/api/admin/config')
    .then(r => r.ok ? r.json() : {})
    .then(data => { cachedConfig = data; return data; })
    .catch(() => ({}));
  return fetchPromise;
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
