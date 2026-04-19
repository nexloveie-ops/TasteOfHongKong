import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { io } from 'socket.io-client';
import { useAuth } from '../../context/AuthContext';
import ReceiptPrint from '../../components/cashier/ReceiptPrint';

interface OrderItem { _id: string; menuItemId: string; quantity: number; unitPrice: number; itemName: string; selectedOptions?: { groupName: string; choiceName: string; extraPrice: number }[]; }
interface TakeoutOrder {
  _id: string; type: string; dailyOrderNumber?: number; status: string;
  items: OrderItem[]; createdAt: string;
}

export default function TakeoutOrderList() {
  const { t } = useTranslation();
  const { token } = useAuth();
  const [orders, setOrders] = useState<TakeoutOrder[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'mixed'>('cash');
  const [cashAmount, setCashAmount] = useState('');
  const [cardAmount, setCardAmount] = useState('');
  const [cashReceived, setCashReceived] = useState('');
  const [checkoutId, setCheckoutId] = useState<string | null>(null);
  const [checkoutMeta, setCheckoutMeta] = useState<{ total: number; cashReceived: number; change: number } | null>(null);

  const fetchOrders = useCallback(async () => {
    try {
      const res = await fetch('/api/orders/takeout', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setOrders(await res.json());
    } catch { /* ignore */ }
  }, [token]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  useEffect(() => {
    const socket = io({ transports: ['websocket'] });
    socket.on('order:new', fetchOrders);
    socket.on('order:updated', fetchOrders);
    return () => { socket.disconnect(); };
  }, [fetchOrders]);

  const selectedOrder = orders.find(o => o._id === selected);
  const orderTotal = (o: TakeoutOrder) => o.items.reduce((s, i) => {
    const optExtra = (i.selectedOptions || []).reduce((a: number, opt: { extraPrice?: number }) => a + (opt.extraPrice || 0), 0);
    return s + (i.unitPrice + optExtra) * i.quantity;
  }, 0);

  // Default cashReceived when selecting order or switching to cash
  useEffect(() => {
    if (paymentMethod === 'cash' && selectedOrder) {
      setCashReceived(orderTotal(selectedOrder).toFixed(2));
    }
  }, [selected, paymentMethod]);

  const cashReceivedNum = parseFloat(cashReceived) || 0;
  const currentTotal = selectedOrder ? orderTotal(selectedOrder) : 0;
  const changeAmount = paymentMethod === 'cash' ? Math.max(0, cashReceivedNum - currentTotal) : 0;
  const cashValid = paymentMethod !== 'cash' || cashReceivedNum >= currentTotal;

  const handleCheckout = async () => {
    if (!selectedOrder) return;
    if (paymentMethod === 'cash' && cashReceivedNum < currentTotal) return;
    setCheckingOut(true);
    try {
      const total = orderTotal(selectedOrder);
      const body: Record<string, unknown> = { paymentMethod };
      if (paymentMethod === 'cash') body.cashAmount = total;
      else if (paymentMethod === 'card') body.cardAmount = total;
      else { body.cashAmount = Number(cashAmount); body.cardAmount = Number(cardAmount); }

      const res = await fetch(`/api/checkout/seat/${selectedOrder._id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        setCheckoutId(data._id);
        setCheckoutMeta({ total, cashReceived: cashReceivedNum, change: changeAmount });
      }
    } catch { /* ignore */ }
    finally { setCheckingOut(false); }
  };

  const handleCloseReceipt = () => {
    setCheckoutId(null);
    setCheckoutMeta(null);
    setSelected(null);
    fetchOrders();
  };

  const handleCancelOrder = async (orderId: string) => {
    if (!confirm('确认取消此订单？Cancel this order?')) return;
    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) { setSelected(null); fetchOrders(); }
    } catch { /* ignore */ }
  };

  // Show receipt after checkout
  if (checkoutId) {
    return (
      <div style={{ maxWidth: 500, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', padding: 20 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>✅</div>
          <h2 style={{ color: 'var(--green)', marginBottom: 12 }}>{t('cashier.checkoutSuccess')}</h2>
          {checkoutMeta && paymentMethod === 'cash' && checkoutMeta.change > 0 && (
            <div style={{
              background: '#FFF3E0', border: '2px solid #FF9800', borderRadius: 12,
              padding: 16, marginBottom: 16, fontSize: 16,
            }}>
              <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 4 }}>{t('cashier.total')}: €{checkoutMeta.total.toFixed(2)}</div>
              <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 4 }}>{t('cashier.cashReceived')}: €{checkoutMeta.cashReceived.toFixed(2)}</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#E65100' }}>
                {t('cashier.change')}: €{checkoutMeta.change.toFixed(2)}
              </div>
            </div>
          )}
          <button className="btn btn-outline" onClick={handleCloseReceipt} style={{ marginBottom: 20 }}>
            {t('common.back')}
          </button>
          <button className="btn btn-primary" onClick={() => window.print()} style={{ marginBottom: 20, marginLeft: 8 }}>
            🖨️ {t('cashier.printReceipt')}
          </button>
        </div>
        <ReceiptPrint checkoutId={checkoutId} cashReceived={checkoutMeta?.cashReceived} changeAmount={checkoutMeta?.change} />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 16, height: '100%' }}>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>{t('cashier.takeout')}</h2>
        {orders.length === 0 && <div style={{ color: 'var(--text-light)', padding: 40, textAlign: 'center' }}>{t('cashier.noOrders')}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {orders.map(o => (
            <div key={o._id} onClick={() => setSelected(o._id)} className="card" style={{
              padding: '14px 16px', cursor: 'pointer',
              border: selected === o._id ? '2px solid var(--red-primary)' : '1px solid var(--border)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--red-primary)' }}>#{o.dailyOrderNumber}</div>
                <div style={{ fontSize: 12, color: 'var(--text-light)' }}>{o.items.length} items · {new Date(o.createdAt).toLocaleTimeString()}</div>
              </div>
              <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--red-primary)', fontFamily: "'Noto Serif SC', serif" }}>€{orderTotal(o).toFixed(2)}</div>
            </div>
          ))}
        </div>
      </div>

      {selectedOrder && (
        <div style={{ width: 360, flexShrink: 0, background: 'var(--bg-white)', borderRadius: 12, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
            <h3 style={{ fontSize: 16, fontWeight: 700 }}>#{selectedOrder.dailyOrderNumber} {t('cashier.orderDetail')}</h3>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
            {selectedOrder.items.map(item => (
              <div key={item._id} style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0', fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{item.itemName} ×{item.quantity}</span>
                  <span style={{ fontWeight: 600, color: 'var(--red-primary)' }}>€{((item.unitPrice + (item.selectedOptions || []).reduce((a: number, o: { extraPrice?: number }) => a + (o.extraPrice || 0), 0)) * item.quantity).toFixed(2)}</span>
                </div>
                {item.selectedOptions && item.selectedOptions.length > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--text-light)', paddingLeft: 8, marginTop: 2 }}>
                    {item.selectedOptions.map((opt, i) => (
                      <span key={i}>{i > 0 && ' · '}{opt.groupName}: {opt.choiceName}{opt.extraPrice > 0 && ` +€${opt.extraPrice}`}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div style={{ padding: 16, borderTop: '2px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 18 }}>
              <span>{t('cashier.total')}</span>
              <span style={{ color: 'var(--red-primary)' }}>€{currentTotal.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['cash', 'card', 'mixed'] as const).map(m => (
                <button key={m} onClick={() => { setPaymentMethod(m); if (m === 'cash') setCashReceived(currentTotal.toFixed(2)); else setCashReceived(''); }} className="btn" style={{
                  flex: 1, fontSize: 12, padding: '8px 0',
                  background: paymentMethod === m ? 'var(--red-primary)' : 'var(--bg)',
                  color: paymentMethod === m ? '#fff' : 'var(--text-secondary)',
                  border: '1px solid var(--border)',
                }}>{t(`cashier.${m}`)}</button>
              ))}
            </div>

            {/* Cash: input received amount + change */}
            {paymentMethod === 'cash' && (
              <div style={{ padding: 10, background: 'var(--bg)', borderRadius: 8 }}>
                <label style={{ fontSize: 12, color: 'var(--text-light)', display: 'block', marginBottom: 4 }}>
                  {t('cashier.cashReceived')}
                </label>
                <input className="input" type="number" step="0.01" min="0" value={cashReceived}
                  onChange={e => setCashReceived(e.target.value)}
                  style={{ width: '100%', fontSize: 16, fontWeight: 700, padding: '8px 10px', textAlign: 'right' }} />
                {cashReceivedNum > 0 && (
                  <div style={{
                    marginTop: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '6px 10px', borderRadius: 6,
                    background: cashReceivedNum >= currentTotal ? '#E8F5E9' : '#FFEBEE',
                  }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{t('cashier.change')}</span>
                    <span style={{
                      fontSize: 18, fontWeight: 700,
                      color: cashReceivedNum >= currentTotal ? 'var(--green)' : 'var(--red-primary)',
                    }}>€{changeAmount.toFixed(2)}</span>
                  </div>
                )}
              </div>
            )}

            {paymentMethod === 'mixed' && (
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="input" placeholder={t('cashier.cashAmount')} value={cashAmount} onChange={e => setCashAmount(e.target.value)} type="number" />
                <input className="input" placeholder={t('cashier.cardAmount')} value={cardAmount} onChange={e => setCardAmount(e.target.value)} type="number" />
              </div>
            )}

            <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleCheckout}
              disabled={checkingOut || (paymentMethod === 'cash' && !cashValid)}>
              {checkingOut ? t('common.loading') : t('cashier.submitCheckout')}
            </button>
            <button className="btn btn-ghost" style={{ width: '100%', marginTop: 8, color: 'var(--red-primary)', border: '1px dashed var(--red-primary)', fontSize: 13 }}
              onClick={() => handleCancelOrder(selectedOrder._id)}>
              ✕ 取消订单
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
