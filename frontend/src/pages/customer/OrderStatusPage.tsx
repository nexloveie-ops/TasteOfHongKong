import { useEffect, useState, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCart } from '../../context/CartContext';
import type { CartItem } from '../../context/CartContext';

interface OrderItem { _id: string; menuItemId: string; quantity: number; unitPrice: number; itemName: string; selectedOptions?: { groupName: string; choiceName: string; extraPrice: number }[]; }
interface Order {
  _id: string; type: string; tableNumber?: number; seatNumber?: number;
  dailyOrderNumber?: number; status: string; items: OrderItem[];
}

export default function OrderStatusPage() {
  const { orderId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { clearCart, setItems, setEditOrderId } = useCart();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const qs = searchParams.toString();

  const fetchOrder = useCallback(async () => {
    try {
      const res = await fetch(`/api/orders/${orderId}`);
      if (!res.ok) throw new Error();
      setOrder(await res.json());
    } catch { setOrder(null); }
    finally { setLoading(false); }
  }, [orderId]);

  useEffect(() => { fetchOrder(); }, [fetchOrder]);

  const total = (items: OrderItem[]) => items.reduce((s, i) => {
    const optExtra = (i.selectedOptions || []).reduce((a, o) => a + (o.extraPrice || 0), 0);
    return s + (i.unitPrice + optExtra) * i.quantity;
  }, 0);

  const handleModifyOrder = () => {
    if (!order) return;
    // Load order items into cart
    const cartItems: CartItem[] = order.items.map(item => ({
      menuItemId: item.menuItemId,
      names: { 'zh-CN': item.itemName, 'en-US': item.itemName }, // snapshot name for both
      price: item.unitPrice,
      quantity: item.quantity,
    }));
    clearCart();
    setItems(cartItems);
    setEditOrderId(order._id);
    // Navigate to menu so user can add/remove items
    navigate(`/customer/menu?${qs}`);
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-light)' }}>{t('customer.loadingOrder')}</div>;
  if (!order) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-light)' }}>{t('customer.orderNotFound')}</div>;

  const isPending = order.status === 'pending';
  const statusLabel = order.status === 'pending' ? t('customer.statusPending')
    : order.status === 'checked_out' ? t('customer.statusCheckedOut')
    : t('customer.statusCompleted');
  const statusColor = order.status === 'pending' ? 'var(--gold-primary)' : order.status === 'checked_out' ? 'var(--blue)' : 'var(--green)';

  return (
    <div style={{ padding: 16, paddingBottom: 80 }}>
      {/* Status header */}
      <div style={{
        background: 'var(--bg-white)', borderRadius: 12, padding: 20, marginBottom: 16,
        border: '1px solid rgba(232,213,184,0.5)', textAlign: 'center',
      }}>
        <div style={{ fontSize: 13, color: 'var(--text-light)', marginBottom: 4 }}>{t('customer.orderNumber')}</div>
        <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "'Noto Serif SC', serif", marginBottom: 8 }}>
          {order.dailyOrderNumber ? `#${order.dailyOrderNumber}` : order._id.slice(-8).toUpperCase()}
        </div>
        <span style={{
          display: 'inline-block', padding: '4px 14px', borderRadius: 20,
          background: statusColor + '20', color: statusColor, fontWeight: 600, fontSize: 13,
        }}>{statusLabel}</span>
        {isPending && (
          <p style={{ marginTop: 12, fontSize: 13, color: 'var(--text-secondary)' }}>
            {t('customer.goToCheckout')}
          </p>
        )}
      </div>

      {/* Items */}
      <div style={{ background: 'var(--bg-white)', borderRadius: 12, border: '1px solid rgba(232,213,184,0.5)', overflow: 'hidden' }}>
        {order.items.map((item, idx) => (
          <div key={item._id || idx} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px',
            borderBottom: '1px solid #f0f0f0',
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{item.itemName}</div>
              {item.selectedOptions && item.selectedOptions.length > 0 && (
                <div style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 2 }}>
                  {item.selectedOptions.map((o, i) => (
                    <span key={i}>{i > 0 && ' · '}{o.groupName}: {o.choiceName}{o.extraPrice > 0 && ` +€${o.extraPrice}`}</span>
                  ))}
                </div>
              )}
              <div style={{ fontSize: 12, color: 'var(--text-light)' }}>€{item.unitPrice} / {t('customer.quantity')}</div>
            </div>
            <span style={{ fontSize: 14, fontWeight: 600 }}>×{item.quantity}</span>
            <span style={{ fontWeight: 700, color: 'var(--red-primary)', minWidth: 50, textAlign: 'right', fontFamily: "'Noto Serif SC', serif" }}>
              €{((item.unitPrice + (item.selectedOptions || []).reduce((a, o) => a + (o.extraPrice || 0), 0)) * item.quantity).toFixed(2)}
            </span>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 16px', fontWeight: 700, fontSize: 16 }}>
          <span>{t('customer.totalAmount')}</span>
          <span style={{ color: 'var(--red-primary)', fontFamily: "'Noto Serif SC', serif" }}>€{total(order.items).toFixed(2)}</span>
        </div>
      </div>

      {/* Actions */}
      <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
        {isPending && (
          <>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleModifyOrder}>
              {t('customer.modifyOrder')}
            </button>
            <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => navigate(`/customer/menu?${qs}`)}>
              {t('customer.backToMenu')}
            </button>
          </>
        )}
        {!isPending && (
          <p style={{ color: 'var(--text-light)', fontSize: 13, textAlign: 'center', width: '100%' }}>
            {t('customer.orderNotModifiable')}
          </p>
        )}
      </div>
    </div>
  );
}
