import { useEffect, useState } from 'react';

interface BusinessStatus {
  isOpen: boolean;
  reason?: 'closed_date' | 'outside_hours';
}

export function useBusinessStatus() {
  const [status, setStatus] = useState<BusinessStatus>({ isOpen: true });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/business-status')
      .then((res) => (res.ok ? res.json() : { isOpen: true }))
      .then((data: BusinessStatus) => {
        if (!cancelled) setStatus(data);
      })
      .catch(() => {
        if (!cancelled) setStatus({ isOpen: true });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { ...status, loading };
}
