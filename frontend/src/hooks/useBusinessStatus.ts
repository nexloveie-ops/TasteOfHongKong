import { useEffect, useState } from 'react';
import { apiFetch } from '../api/client';
import { useStoreSlug } from '../context/StoreContext';

interface BusinessStatus {
  isOpen: boolean;
  reason?: 'closed_date' | 'outside_hours';
  /** 与 `cashier.delivery.page` 一致；缺省时视为 true（兼容旧后端） */
  deliveryEnabled?: boolean;
  /** 与 `cashier.member.wallet` 一致；缺省时视为 true（兼容旧后端） */
  memberWalletEnabled?: boolean;
}

export function useBusinessStatus() {
  const slug = useStoreSlug();
  const [status, setStatus] = useState<BusinessStatus>({ isOpen: true, deliveryEnabled: true });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch('/api/admin/business-status')
      .then((res) => (res.ok ? res.json() : { isOpen: true }))
      .then((data: BusinessStatus) => {
        if (!cancelled) {
          const deliveryEnabled = typeof data.deliveryEnabled === 'boolean' ? data.deliveryEnabled : true;
          const memberWalletEnabled = typeof data.memberWalletEnabled === 'boolean' ? data.memberWalletEnabled : true;
          setStatus({ ...data, deliveryEnabled, memberWalletEnabled });
        }
      })
      .catch(() => {
        if (!cancelled) setStatus({ isOpen: true, deliveryEnabled: true, memberWalletEnabled: true });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return { ...status, loading };
}
