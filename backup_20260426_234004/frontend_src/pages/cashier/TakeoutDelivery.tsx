import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';

interface OrderItem { _id: string; quantity: number; unitPrice: number; itemName: string; }
interface PendingOrder { _id: string; dailyOrderNumber?: number; items: OrderItem[]; createdAt: string; }

export default function TakeoutDelivery() {
  const { t } = useTranslation();
  const { token } = useAuth();
  const [orders, setOrders] = useState<PendingOrder[]>([]);

  const fetchPending = useCallback(async () => {
    try {
      const res = await fetch('/api/orders/takeout/pending', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setOrders(await res.json());
    } catch { /* ignore */ }
  }, [token]);

  useEffect(() => { fetchPending(); }, [fetchPending]);

  const markComplete = async (id: string) => {
    try {
      await fetch(`/api/orders/takeout/${id}/complete`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchPending();
    } catch { /* ignore */ }
  };

  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>{t('cashier.pendingPickup')}</h2>
      {orders.length === 0 && <div style={{ color: 'var(--text-light)', padding: 40, textAlign: 'center' }}>{t('cashier.noOrders')}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
        {orders.map(o => (
          <div key={o._id} className="card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--red-primary)', fontFamily: "'Noto Serif SC', serif" }}>
                #{o.dailyOrderNumber}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-light)' }}>{new Date(o.createdAt).toLocaleTimeString()}</span>
            </div>
            {o.items.map(item => (
              <div key={item._id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', borderBottom: '1px solid #f5f5f5' }}>
                <span>{item.itemName} ×{item.quantity}</span>
                <span style={{ color: 'var(--text-secondary)' }}>€{item.unitPrice * item.quantity}</span>
              </div>
            ))}
            <button className="btn btn-primary" style={{ width: '100%', marginTop: 12 }} onClick={() => markComplete(o._id)}>
              {t('cashier.markComplete')}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
