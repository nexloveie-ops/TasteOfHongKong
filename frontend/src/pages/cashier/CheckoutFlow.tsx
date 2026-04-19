import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { type Order, type OrderItem } from '../../components/cashier/OrderDetail';
import ReceiptPrint from '../../components/cashier/ReceiptPrint';

interface EditableItem extends OrderItem {
  editPrice: number; // editable unit price (for discount)
}

interface SeatGroup {
  seatNumber: number;
  orders: Order[];
  mergedItems: EditableItem[];
  total: number;
}

function mergeSeatItems(orders: Order[]): EditableItem[] {
  const map = new Map<string, EditableItem>();
  for (const o of orders) {
    for (const item of o.items) {
      const optExtra = (item.selectedOptions || []).reduce((s: number, opt: { extraPrice?: number }) => s + (opt.extraPrice || 0), 0);
      const existing = map.get(item.menuItemId);
      if (existing) {
        existing.quantity += item.quantity;
      } else {
        map.set(item.menuItemId, { ...item, editPrice: item.unitPrice + optExtra });
      }
    }
  }
  return [...map.values()];
}

function calcTotal(items: EditableItem[]): number {
  return items.reduce((s, i) => s + i.editPrice * i.quantity, 0);
}

function groupBySeat(orders: Order[]): SeatGroup[] {
  const map = new Map<number, Order[]>();
  for (const o of orders) {
    const seat = o.seatNumber ?? 0;
    if (!map.has(seat)) map.set(seat, []);
    map.get(seat)!.push(o);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a - b)
    .map(([seatNumber, seatOrders]) => {
      const mergedItems = mergeSeatItems(seatOrders);
      return { seatNumber, orders: seatOrders, mergedItems, total: calcTotal(mergedItems) };
    });
}

export default function CheckoutFlow() {
  const { tableNumber, orderId } = useParams();
  const { t } = useTranslation();
  const { token } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [mode, setMode] = useState<'table' | 'seat'>('table');
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'mixed'>('cash');
  const [cashAmount, setCashAmount] = useState('');
  const [cardAmount, setCardAmount] = useState('');
  const [cashReceived, setCashReceived] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkoutId, setCheckoutId] = useState<string | null>(null);
  const [checkoutMeta, setCheckoutMeta] = useState<{ total: number; cashReceived: number; change: number } | null>(null);
  const [error, setError] = useState('');

  // Editable items (for price discount)
  const [editableItems, setEditableItems] = useState<EditableItem[]>([]);

  // Default cashReceived to total when items change and payment is cash
  useEffect(() => {
    if (paymentMethod === 'cash' && editableItems.length > 0) {
      setCashReceived(calcTotal(editableItems).toFixed(2));
    }
  }, [editableItems, paymentMethod]);

  const fetchOrders = useCallback(async () => {
    if (orderId) {
      const res = await fetch(`/api/orders/${orderId}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const o = await res.json();
        setOrders([o]);
        setMode('seat');
        setSelectedSeat(o.seatNumber ?? 0);
      }
    } else if (tableNumber) {
      const res = await fetch('/api/orders/dine-in', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const allOrders: Order[] = await res.json();
        setOrders(allOrders.filter(o => o.tableNumber === Number(tableNumber)));
      }
    }
  }, [tableNumber, orderId, token]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  // Rebuild editable items when orders or mode/seat changes
  const seatGroups = useMemo(() => groupBySeat(orders), [orders]);

  useEffect(() => {
    const activeSG = seatGroups.find(g => g.seatNumber === selectedSeat);
    const items = mode === 'seat' && activeSG ? activeSG.mergedItems : mergeSeatItems(orders);
    setEditableItems(items);
  }, [orders, mode, selectedSeat, seatGroups]);

  const displayTotal = calcTotal(editableItems);

  const updateItemPrice = (menuItemId: string, newPrice: number) => {
    setEditableItems(prev => prev.map(i => i.menuItemId === menuItemId ? { ...i, editPrice: Math.max(0, newPrice) } : i));
  };

  // Cash change calculation
  const cashReceivedNum = parseFloat(cashReceived) || 0;
  const changeAmount = paymentMethod === 'cash' ? Math.max(0, cashReceivedNum - displayTotal) : 0;
  const cashValid = paymentMethod !== 'cash' || cashReceivedNum >= displayTotal;

  const handleCheckout = async () => {
    if (paymentMethod === 'cash' && cashReceivedNum < displayTotal) {
      setError(t('cashier.insufficientCash', '实收金额不足'));
      return;
    }
    setLoading(true);
    setError('');
    try {
      const body: Record<string, unknown> = { paymentMethod };
      if (paymentMethod === 'cash') body.cashAmount = displayTotal;
      else if (paymentMethod === 'card') body.cardAmount = displayTotal;
      else { body.cashAmount = Number(cashAmount); body.cardAmount = Number(cardAmount); }

      const meta = { total: displayTotal, cashReceived: cashReceivedNum, change: changeAmount };

      if (mode === 'table') {
        const res = await fetch(`/api/checkout/table/${tableNumber}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        });
        if (!res.ok) { const d = await res.json().catch(() => null); throw new Error(d?.error?.message || 'Checkout failed'); }
        const data = await res.json();
        setCheckoutId(data._id);
        setCheckoutMeta(meta);
      } else {
        const activeSG = seatGroups.find(g => g.seatNumber === selectedSeat);
        if (!activeSG) return;
        let lastId = '';
        for (const order of activeSG.orders) {
          const res = await fetch(`/api/checkout/seat/${order._id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(body),
          });
          if (!res.ok) { const d = await res.json().catch(() => null); throw new Error(d?.error?.message || 'Checkout failed'); }
          const data = await res.json();
          lastId = data._id;
        }
        setCheckoutId(lastId);
        setCheckoutMeta(meta);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Checkout failed');
    } finally {
      setLoading(false);
    }
  };

  // Success screen with change display
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
              <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 4 }}>{t('cashier.cashReceived', '实收')}: €{checkoutMeta.cashReceived.toFixed(2)}</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#E65100' }}>
                {t('cashier.change', '找零')}: €{checkoutMeta.change.toFixed(2)}
              </div>
            </div>
          )}
          <button className="btn btn-outline" onClick={() => navigate('/cashier')} style={{ marginBottom: 20 }}>
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

  const activeSeatGroup = seatGroups.find(g => g.seatNumber === selectedSeat);

  return (
    <div style={{ maxWidth: 700, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>
          {t('cashier.checkout')} — {tableNumber ? `${t('cashier.table')} ${tableNumber}` : 'Order'}
        </h2>
        <button className="btn btn-outline" onClick={() => navigate('/cashier')}>{t('common.back')}</button>
      </div>

      {/* Mode selector */}
      {tableNumber && !orderId && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button className="btn" onClick={() => { setMode('table'); setSelectedSeat(null); }}
            style={{ flex: 1, background: mode === 'table' ? 'var(--red-primary)' : 'var(--bg)', color: mode === 'table' ? '#fff' : 'var(--text-secondary)', border: '1px solid var(--border)' }}>
            {t('cashier.wholeTable')}
          </button>
          <button className="btn" onClick={() => { setMode('seat'); if (!selectedSeat && seatGroups.length > 0) setSelectedSeat(seatGroups[0].seatNumber); }}
            style={{ flex: 1, background: mode === 'seat' ? 'var(--red-primary)' : 'var(--bg)', color: mode === 'seat' ? '#fff' : 'var(--text-secondary)', border: '1px solid var(--border)' }}>
            {t('cashier.bySeat')}
          </button>
        </div>
      )}

      {/* Seat selector */}
      {mode === 'seat' && tableNumber && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {seatGroups.map(g => (
            <button key={g.seatNumber} className="btn" onClick={() => setSelectedSeat(g.seatNumber)}
              style={{
                background: selectedSeat === g.seatNumber ? 'var(--blue)' : 'var(--bg)',
                color: selectedSeat === g.seatNumber ? '#fff' : 'var(--text-secondary)',
                border: '1px solid var(--border)', fontSize: 13, minWidth: 80,
              }}>
              {t('cashier.seat')} {g.seatNumber}
              <span style={{ display: 'block', fontSize: 11, opacity: 0.8 }}>€{g.total.toFixed(2)}</span>
            </button>
          ))}
        </div>
      )}

      {/* Editable items */}
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        {mode === 'seat' && activeSeatGroup && (
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: 'var(--text-secondary)' }}>
            {t('cashier.seat')} {activeSeatGroup.seatNumber}
          </div>
        )}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border)' }}>
              <th style={{ padding: '8px 0', textAlign: 'left' }}>菜品</th>
              <th style={{ padding: '8px 0', textAlign: 'center', width: 50 }}>数量</th>
              <th style={{ padding: '8px 0', textAlign: 'right', width: 100 }}>单价</th>
              <th style={{ padding: '8px 0', textAlign: 'right', width: 80 }}>小计</th>
            </tr>
          </thead>
          <tbody>
            {editableItems.map(item => {
              const discounted = item.editPrice < item.unitPrice;
              return (
                <tr key={item.menuItemId} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '8px 0', fontWeight: 500 }}>
                    {item.itemName}
                    {item.selectedOptions && item.selectedOptions.length > 0 && (
                      <div style={{ fontSize: 11, color: 'var(--text-light)', fontWeight: 400, marginTop: 1 }}>
                        {item.selectedOptions.map((opt, i) => (
                          <span key={i}>{i > 0 && ' · '}{opt.groupName}: {opt.choiceName}{opt.extraPrice > 0 && ` +€${opt.extraPrice}`}</span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '8px 0', textAlign: 'center' }}>×{item.quantity}</td>
                  <td style={{ padding: '8px 0', textAlign: 'right' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                      {discounted && (
                        <span style={{ textDecoration: 'line-through', color: 'var(--text-light)', fontSize: 11 }}>€{item.unitPrice}</span>
                      )}
                      <input
                        type="number"
                        value={item.editPrice}
                        onChange={e => updateItemPrice(item.menuItemId, Number(e.target.value))}
                        step="0.01"
                        min="0"
                        style={{
                          width: 60, padding: '4px 6px', fontSize: 13, textAlign: 'right',
                          border: discounted ? '2px solid #FF9800' : '1px solid var(--border)',
                          borderRadius: 4, background: discounted ? '#FFF8E1' : 'var(--bg)',
                          fontWeight: 600, color: discounted ? '#E65100' : 'var(--text-primary)',
                        }}
                      />
                    </div>
                  </td>
                  <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 600 }}>€{(item.editPrice * item.quantity).toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {error && <div style={{ color: 'var(--red-primary)', marginBottom: 12, fontSize: 13 }}>{error}</div>}

      {/* Payment */}
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 20, marginBottom: 16 }}>
          <span>{t('cashier.total')}</span>
          <span style={{ color: 'var(--red-primary)', fontFamily: "'Noto Serif SC', serif" }}>€{displayTotal.toFixed(2)}</span>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {(['cash', 'card', 'mixed'] as const).map(m => (
            <button key={m} onClick={() => { setPaymentMethod(m); if (m === 'cash') setCashReceived(displayTotal.toFixed(2)); else setCashReceived(''); }} className="btn" style={{
              flex: 1, background: paymentMethod === m ? 'var(--red-primary)' : 'var(--bg)',
              color: paymentMethod === m ? '#fff' : 'var(--text-secondary)',
              border: '1px solid var(--border)',
            }}>{t(`cashier.${m}`)}</button>
          ))}
        </div>

        {/* Cash: input received amount + show change */}
        {paymentMethod === 'cash' && (
          <div style={{ marginBottom: 12, padding: 12, background: 'var(--bg)', borderRadius: 8 }}>
            <label style={{ fontSize: 12, color: 'var(--text-light)', display: 'block', marginBottom: 4 }}>
              {t('cashier.cashReceived', '客人支付金额')}
            </label>
            <input className="input" type="number" step="0.01" min="0" value={cashReceived}
              onChange={e => setCashReceived(e.target.value)}
              placeholder={`≥ €${displayTotal.toFixed(2)}`}
              style={{ width: '100%', fontSize: 18, fontWeight: 700, padding: '10px 12px', textAlign: 'right' }} />
            {cashReceivedNum > 0 && (
              <div style={{
                marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '8px 12px', borderRadius: 6,
                background: cashReceivedNum >= displayTotal ? '#E8F5E9' : '#FFEBEE',
              }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{t('cashier.change', '找零')}</span>
                <span style={{
                  fontSize: 22, fontWeight: 700,
                  color: cashReceivedNum >= displayTotal ? 'var(--green)' : 'var(--red-primary)',
                }}>
                  €{changeAmount.toFixed(2)}
                </span>
              </div>
            )}
          </div>
        )}

        {paymentMethod === 'mixed' && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input className="input" placeholder={t('cashier.cashAmount')} value={cashAmount} onChange={e => setCashAmount(e.target.value)} type="number" />
            <input className="input" placeholder={t('cashier.cardAmount')} value={cardAmount} onChange={e => setCardAmount(e.target.value)} type="number" />
          </div>
        )}

        <button className="btn btn-primary" style={{ width: '100%', fontSize: 16, padding: '14px 0' }}
          onClick={handleCheckout}
          disabled={loading || (mode === 'seat' && !activeSeatGroup) || (paymentMethod === 'cash' && !cashValid)}>
          {loading ? t('common.loading') : t('cashier.submitCheckout')}
        </button>
      </div>
    </div>
  );
}
