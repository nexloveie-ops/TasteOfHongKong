import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { buildReceiptHTML, printViaIframe } from '../../components/cashier/ReceiptPrint';

interface SearchResult {
  checkoutId: string;
  type: string;
  tableNumber?: number;
  totalAmount: number;
  paymentMethod: string;
  cashAmount?: number;
  cardAmount?: number;
  checkedOutAt: string;
  orders: {
    _id: string;
    type: string;
    tableNumber?: number;
    seatNumber?: number;
    dailyOrderNumber?: number;
    dineInOrderNumber?: string;
    items: { _id: string; menuItemId: string; itemName: string; itemNameEn?: string; quantity: number; unitPrice: number; selectedOptions?: { groupName: string; choiceName: string; extraPrice: number }[] }[];
  }[];
}

export default function ReprintReceipt() {
  const { t } = useTranslation();
  const { token } = useAuth();
  const [orderNumber, setOrderNumber] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [noResults, setNoResults] = useState(false);
  const [printing, setPrinting] = useState<string | null>(null);
  const [config, setConfig] = useState<Record<string, string>>({});

  // Fetch restaurant config once
  useEffect(() => {
    fetch('/api/admin/config').then(r => r.ok ? r.json() : {}).then(setConfig).catch(() => {});
  }, []);

  const handleSearch = useCallback(async (searchNum?: string) => {
    const num = searchNum ?? orderNumber;
    setSearching(true);
    setNoResults(false);
    setResults([]);
    try {
      const params = new URLSearchParams({ date });
      if (num.trim()) params.set('orderNumber', num.trim());
      const res = await fetch(`/api/checkout/search?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data: SearchResult[] = await res.json();
        setResults(data);
        if (data.length === 0) setNoResults(true);
      }
    } catch { /* ignore */ }
    finally { setSearching(false); }
  }, [orderNumber, date, token]);

  // Auto-load today's orders on mount
  useEffect(() => { handleSearch(''); }, []);

  const handlePrint = (r: SearchResult) => {
    setPrinting(r.checkoutId);
    // Build receipt data in the format buildReceiptHTML expects
    const receiptData = {
      checkoutId: r.checkoutId,
      type: r.type as 'table' | 'seat',
      tableNumber: r.tableNumber,
      totalAmount: r.totalAmount,
      paymentMethod: r.paymentMethod as 'cash' | 'card' | 'mixed',
      cashAmount: r.cashAmount,
      cardAmount: r.cardAmount,
      checkedOutAt: r.checkedOutAt,
      orders: r.orders.map(o => ({
        _id: o._id,
        type: o.type as 'dine_in' | 'takeout',
        tableNumber: o.tableNumber,
        seatNumber: o.seatNumber,
        dailyOrderNumber: o.dailyOrderNumber,
        dineInOrderNumber: o.dineInOrderNumber,
        status: 'checked_out',
        items: o.items,
      })),
    };
    const html = buildReceiptHTML(receiptData, config);
    printViaIframe(html, 1);
    setTimeout(() => setPrinting(null), 2000);
  };

  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>重印小票</h2>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-light)', display: 'block', marginBottom: 4 }}>订单号码</label>
            <input className="input" value={orderNumber} onChange={e => setOrderNumber(e.target.value)}
              placeholder="例: 143025 或 外卖号"
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              style={{ width: 180, fontSize: 16, fontWeight: 600 }} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-light)', display: 'block', marginBottom: 4 }}>日期</label>
            <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} style={{ width: 160 }} />
          </div>
          <button className="btn btn-primary" onClick={() => handleSearch()} disabled={searching} style={{ padding: '8px 20px' }}>
            {searching ? t('common.loading') : t('common.search')}
          </button>
        </div>
      </div>

      {noResults && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-light)' }}>未找到匹配的订单</div>
      )}

      {results.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {results.map(r => {
            const isDineIn = r.orders[0]?.type === 'dine_in';
            const typeLabel = isDineIn ? '堂食 Dine-in' : '外卖 Takeout';
            const orderNum = r.orders[0]?.dineInOrderNumber || (r.orders[0]?.dailyOrderNumber ? `#${r.orders[0].dailyOrderNumber}` : '');
            const time = new Date(r.checkedOutAt).toLocaleTimeString();
            return (
              <div key={r.checkoutId} className="card" style={{ padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16, color: isDineIn ? 'var(--red-primary)' : 'var(--blue)' }}>
                    {typeLabel} {orderNum && `· ${orderNum}`} · €{r.totalAmount.toFixed(2)}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-light)', marginTop: 2 }}>
                    {r.tableNumber != null && r.tableNumber > 0 && `Table ${r.tableNumber} · `}
                    {r.paymentMethod} · {time}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 2 }}>
                    {r.orders.flatMap(o => o.items).map((item, i) => (
                      <span key={i}>{i > 0 && ', '}{item.itemName} ×{item.quantity}</span>
                    ))}
                  </div>
                </div>
                <button className="btn btn-primary" style={{ padding: '8px 16px', fontSize: 13 }}
                  disabled={printing === r.checkoutId}
                  onClick={() => handlePrint(r)}>
                  {printing === r.checkoutId ? '🖨️...' : '🖨️ 打印'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
