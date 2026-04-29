import { useEffect, useState, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCart } from '../../context/CartContext';
import type { CartItem } from '../../context/CartContext';
import PaymentModal from '../../components/customer/PaymentModal';

interface OrderItem { _id: string; menuItemId: string; quantity: number; unitPrice: number; itemName: string; selectedOptions?: { groupName: string; choiceName: string; extraPrice: number }[]; }
interface AppliedBundle { offerId?: string; name: string; nameEn?: string; discount: number; }
interface Order {
  _id: string; type: string; tableNumber?: number; seatNumber?: number;
  dailyOrderNumber?: number; status: string; items: OrderItem[];
  appliedBundles?: AppliedBundle[];
}

export default function OrderStatusPage() {
  const { orderId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { clearCart, setItems, setEditOrderId } = useCart();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPayment, setShowPayment] = useState(false);
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
  const isPaidOnline = order.status === 'paid_online';
  const statusLabel = order.status === 'pending' ? t('customer.statusPending')
    : order.status === 'paid_online' ? t('customer.statusPaidOnline')
    : order.status === 'checked_out' ? t('customer.statusCheckedOut')
    : t('customer.statusCompleted');
  const statusColor = order.status === 'pending' ? 'var(--gold-primary)' : order.status === 'paid_online' ? '#2E7D32' : order.status === 'checked_out' ? 'var(--blue)' : 'var(--green)';

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
        {isPaidOnline && (
          <div style={{ marginTop: 14, padding: '12px 16px', background: '#E8F5E9', border: '2px solid #4CAF50', borderRadius: 10, textAlign: 'center' }}>
            <p style={{ fontSize: 15, fontWeight: 700, color: '#2E7D32', lineHeight: 1.6 }}>
              {t('customer.paymentSuccess')}
            </p>
          </div>
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
        {order.appliedBundles && order.appliedBundles.length > 0 && (() => {
          const bundleDiscount = order.appliedBundles.reduce((s, b) => s + b.discount, 0);
          const netTotal = total(order.items) - bundleDiscount;
          return (
            <div style={{ padding: '0 16px 14px' }}>
              {order.appliedBundles.map((b, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#2E7D32', padding: '2px 0' }}>
                  <span>🎁 {b.name}{b.nameEn ? ` ${b.nameEn}` : ''}</span>
                  <span style={{ fontWeight: 600 }}>-€{b.discount.toFixed(2)}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 18, marginTop: 6, paddingTop: 6, borderTop: '1px solid #eee' }}>
                <span>{t('customer.totalAmount')}</span>
                <span style={{ color: 'var(--red-primary)', fontFamily: "'Noto Serif SC', serif" }}>€{netTotal.toFixed(2)}</span>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Actions */}
      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {isPending && (
          <>
            {/* Online Payment Button */}
            <button className="btn" onClick={() => setShowPayment(true)}
              style={{
                width: '100%', padding: '14px 0', fontSize: 16, fontWeight: 700,
                background: '#000', color: '#fff', border: 'none', borderRadius: 12,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}>
              <span style={{ fontSize: 20 }}>💳</span> {t('customer.payNow')} · €{(() => {
                const itemsTotal = total(order.items);
                const bundleDisc = (order.appliedBundles || []).reduce((s, b) => s + b.discount, 0);
                return (itemsTotal - bundleDisc).toFixed(2);
              })()}
            </button>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleModifyOrder}>
                {t('customer.modifyOrder')}
              </button>
              <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => navigate(`/customer/menu?${qs}`)}>
                {t('customer.backToMenu')}
              </button>
            </div>
          </>
        )}
        {!isPending && !isPaidOnline && (
          <p style={{ color: 'var(--text-light)', fontSize: 13, textAlign: 'center', width: '100%' }}>
            {t('customer.orderNotModifiable')}
          </p>
        )}
        {isPaidOnline && (
          <button className="btn btn-outline" style={{ width: '100%' }} onClick={() => navigate(`/customer/menu?${qs}`)}>
            {t('customer.backToMenu')}
          </button>
        )}
      </div>

      {/* Payment Modal */}
      {showPayment && order && (
        <PaymentModal
          orderId={order._id}
          amount={(() => {
            const itemsTotal = total(order.items);
            const bundleDisc = (order.appliedBundles || []).reduce((s, b) => s + b.discount, 0);
            return itemsTotal - bundleDisc;
          })()}
          onSuccess={() => {
            setShowPayment(false);
            fetchOrder(); // Refresh to show checked_out status
          }}
          onClose={() => setShowPayment(false)}
        />
      )}
    </div>
  );
}
