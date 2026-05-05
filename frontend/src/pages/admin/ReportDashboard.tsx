import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { apiFetch } from '../../api/client';

interface TopItem {
  itemName: string;
  itemNameEn: string;
  quantity: number;
  revenue: number;
}

interface DetailedStats {
  totalRevenue: number;
  grossRevenue: number;
  orderCount: number;
  cashTotal: number;
  cardTotal: number;
  mixedTotal: number;
  dineInCount: number;
  takeoutCount: number;
  phoneCount: number;
  phoneRevenue: number;
  dineInScanCount: number;
  dineInCashierCount: number;
  takeoutScanCount: number;
  takeoutCashierCount: number;
  refundedCount: number;
  refundedAmount: number;
  onlineTotal: number;
  onlineCount: number;
  couponCount: number;
  couponTotalAmount: number;
  bundleOfferCount: number;
  bundleOfferDiscount: number;
  topItems: TopItem[];
}

interface OrderItem {
  _id: string;
  quantity: number;
  unitPrice: number;
  itemName: string;
  itemNameEn?: string;
  refunded?: boolean;
  selectedOptions?: { groupName?: string; choiceName?: string; extraPrice?: number }[];
}

interface DetailOrder {
  _id: string;
  type: string;
  tableNumber?: number;
  seatNumber?: number;
  dailyOrderNumber?: number;
  dineInOrderNumber?: string;
  items: OrderItem[];
  appliedBundles?: { name: string; nameEn?: string; discount: number }[];
  createdAt: string;
  checkout?: {
    checkoutId: string;
    totalAmount: number;
    paymentMethod: string;
    cashAmount?: number;
    cardAmount?: number;
    checkedOutAt: string;
  } | null;
}

interface ModalConfig {
  title: string;
  icon: string;
  filters: Record<string, string>;
}

function getWeekRange(): { start: string; end: string } {
  const today = new Date();
  const day = today.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(today);
  monday.setDate(today.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(monday), end: fmt(sunday) };
}

export default function ReportDashboard() {
  const { t } = useTranslation();
  const { token } = useAuth();

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [stats, setStats] = useState<DetailedStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [pdfExporting, setPdfExporting] = useState(false);

  // Modal state
  const [modalConfig, setModalConfig] = useState<ModalConfig | null>(null);
  const [modalOrders, setModalOrders] = useState<DetailOrder[]>([]);
  const [modalLoading, setModalLoading] = useState(false);

  // Item option modal
  interface ItemOptionStats { itemName: string; totalSold: number; withPaidOptions: number; totalOptionRevenue: number; options: { groupName: string; choiceName: string; extraPrice: number; count: number; revenue: number }[]; }
  const [itemOptionStats, setItemOptionStats] = useState<ItemOptionStats | null>(null);
  const [itemOptionLoading, setItemOptionLoading] = useState(false);

  useEffect(() => {
    const { start, end } = getWeekRange();
    setStartDate(start);
    setEndDate(end);
  }, []);

  const fetchStats = useCallback(async () => {
    if (!startDate || !endDate) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('startDate', startDate);
      params.set('endDate', endDate);
      const res = await apiFetch(`/api/reports/detailed?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setStats(await res.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [token, startDate, endDate]);

  const exportVatPdf = useCallback(async () => {
    if (!startDate || !endDate) return;
    setPdfExporting(true);
    try {
      const params = new URLSearchParams({ startDate, endDate });
      const res = await apiFetch(`/api/reports/vat-pdf?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        let detail = '';
        try {
          const ct = res.headers.get('content-type') ?? '';
          if (ct.includes('application/json')) {
            const data = (await res.json()) as { error?: { message?: string } };
            detail = data?.error?.message?.trim() ?? '';
          } else {
            const text = (await res.text()).trim();
            if (text.length > 0 && text.length < 500) detail = text;
          }
        } catch {
          /* ignore parse errors */
        }
        alert(detail ? `${t('admin.exportVatPdfFailed')}\n${detail}` : t('admin.exportVatPdfFailed'));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vat-report-${startDate}_${endDate}.pdf`;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      alert(t('admin.exportVatPdfFailed'));
    } finally {
      setPdfExporting(false);
    }
  }, [token, startDate, endDate, t]);

  const openDetail = useCallback(async (config: ModalConfig) => {
    setModalConfig(config);
    setModalOrders([]);
    setModalLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('startDate', startDate);
      params.set('endDate', endDate);
      for (const [k, v] of Object.entries(config.filters)) {
        if (v) params.set(k, v);
      }
      const res = await apiFetch(`/api/reports/orders?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setModalOrders(await res.json());
    } catch { /* ignore */ }
    finally { setModalLoading(false); }
  }, [token, startDate, endDate]);

  const closeModal = () => { setModalConfig(null); setModalOrders([]); };

  const openItemOptions = async (itemName: string) => {
    setItemOptionLoading(true);
    setItemOptionStats(null);
    try {
      const params = new URLSearchParams({ itemName, startDate, endDate });
      const res = await apiFetch(`/api/reports/item-options?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setItemOptionStats(await res.json());
    } catch { /* ignore */ }
    finally { setItemOptionLoading(false); }
  };

  const euro = (v: number) => `€${v.toFixed(2)}`;

  /** Calculate refund amount for an order, considering bundle discounts */
  const calcOrderRefund = (o: DetailOrder) => {
    const refundedItems = o.items.filter(i => i.refunded);
    if (refundedItems.length === 0) return 0;
    const allRefunded = o.items.length > 0 && o.items.every(i => i.refunded);
    if (allRefunded && o.checkout) return o.checkout.totalAmount;
    // Partial refund: proportionally distribute bundle discount
    let refundedTotal = 0;
    let allTotal = 0;
    for (const i of o.items) {
      const optExtra = (i.selectedOptions || []).reduce((x, op) => x + (op.extraPrice || 0), 0);
      const amt = (i.unitPrice + optExtra) * i.quantity;
      allTotal += amt;
      if (i.refunded) refundedTotal += amt;
    }
    const bundleDisc = (o.appliedBundles || []).reduce((s, b) => s + b.discount, 0);
    if (allTotal > 0 && bundleDisc > 0) return refundedTotal * (1 - bundleDisc / allTotal);
    return refundedTotal;
  };

  const orderTotal = (o: DetailOrder) =>
    o.checkout?.totalAmount ?? o.items.reduce((s, i) => s + (i.unitPrice + (i.selectedOptions || []).reduce((x, op) => x + (op.extraPrice || 0), 0)) * i.quantity, 0);

  /** De-duplicate checkout totals (one checkout may cover multiple orders) */
  const deduplicatedTotal = (orders: DetailOrder[]) => {
    const seen = new Set<string>();
    let total = 0;
    for (const o of orders) {
      if (o.checkout) {
        const key = o.checkout.checkoutId;
        if (!seen.has(key)) {
          seen.add(key);
          total += o.checkout.totalAmount;
        }
      } else {
        total += o.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
      }
    }
    return total;
  };

  const orderNum = (o: DetailOrder) =>
    o.dineInOrderNumber || (o.dailyOrderNumber ? `#${o.dailyOrderNumber}` : o._id.slice(-6).toUpperCase());

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>{t('admin.reports')}</h2>

      {/* Date picker */}
      <div className="card" style={{ padding: 16, marginBottom: 16, display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
        <div>
          <label style={{ fontSize: 12, color: 'var(--text-light)', display: 'block', marginBottom: 4 }}>开始日期</label>
          <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div>
          <label style={{ fontSize: 12, color: 'var(--text-light)', display: 'block', marginBottom: 4 }}>结束日期</label>
          <input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <button className="btn btn-primary" onClick={fetchStats} disabled={loading || !startDate || !endDate}>
          {loading ? t('common.loading') : t('common.search')}
        </button>
        <button
          type="button"
          className="btn btn-outline"
          onClick={exportVatPdf}
          disabled={pdfExporting || !startDate || !endDate}
        >
          {pdfExporting ? t('common.loading') : t('admin.exportVatPdf')}
        </button>
      </div>

      {/* Stats display */}
      {stats && (
        <>
          {/* Revenue Summary Cards */}
          <div style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, color: 'var(--text-secondary)' }}>💰 营业概览</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
              <StatCard label="净营业额" value={euro(stats.totalRevenue)} color="var(--red-primary)" icon="💰"
                onClick={() => openDetail({ title: '💰 全部订单', icon: '💰', filters: {} })} />
              <StatCard label="订单数量" value={String(stats.orderCount)} color="var(--blue, #1976D2)" icon="📋"
                onClick={() => openDetail({ title: '📋 全部订单', icon: '📋', filters: {} })} />
              <StatCard label="现金收入" value={euro(stats.cashTotal)} color="var(--green, #388E3C)" icon="💵"
                onClick={() => openDetail({ title: '💵 现金订单', icon: '💵', filters: { paymentMethod: 'cash' } })} />
              <StatCard label="刷卡收入" value={euro(stats.cardTotal)} color="var(--blue, #1976D2)" icon="💳"
                onClick={() => openDetail({ title: '💳 刷卡订单', icon: '💳', filters: { paymentMethod: 'card' } })} />
              <StatCard label="混合支付" value={euro(stats.mixedTotal)} color="var(--gold-dark, #F57F17)" icon="🔄"
                onClick={() => openDetail({ title: '🔄 混合支付订单', icon: '🔄', filters: { paymentMethod: 'mixed' } })} />
              <StatCard label="Online" value={`${stats.onlineCount} 单 · ${euro(stats.onlineTotal)}`} color="#7B1FA2" icon="💳"
                onClick={() => openDetail({ title: '💳 Online Payment', icon: '💳', filters: { paymentMethod: 'online' } })} />
              <StatCard label="Coupon" value={`${stats.couponCount} 次 · ${euro(stats.couponTotalAmount)}`} color="#FF6F00" icon="🎟️"
                onClick={() => openDetail({ title: '🎟️ Coupon Orders', icon: '🎟️', filters: { hasCoupon: 'true' } })} />
              <StatCard label="Bundle" value={`${stats.bundleOfferCount} 次 · -${euro(stats.bundleOfferDiscount)}`} color="#00897B" icon="🎁"
                onClick={() => openDetail({ title: '🎁 Bundle Orders', icon: '🎁', filters: { hasBundle: 'true' } })} />
              <StatCard label="退单" value={`${stats.refundedCount} 项 · ${euro(stats.refundedAmount)}`} color="#F44336" icon="↩️"
                onClick={() => openDetail({ title: '↩️ 退单记录', icon: '↩️', filters: { status: 'refunded' } })} />
            </div>
          </div>

          {/* Order Breakdown */}
          <div style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, color: 'var(--text-secondary)' }}>📊 订单分类</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
              {/* Dine-in card */}
              <div className="card" style={{ padding: 20, cursor: 'pointer', transition: 'box-shadow 0.2s' }}
                onClick={() => openDetail({ title: '🍽️ 堂食订单', icon: '🍽️', filters: { type: 'dine_in' } })}
                onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)')}
                onMouseLeave={e => (e.currentTarget.style.boxShadow = '')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <span style={{ fontSize: 24 }}>🍽️</span>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--text-light)' }}>堂食订单</div>
                    <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--red-primary)' }}>{stats.dineInCount}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 16, borderTop: '1px solid var(--border, #eee)', paddingTop: 10, fontSize: 13 }}>
                  <div style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); openDetail({ title: '📱 堂食扫码点餐', icon: '📱', filters: { type: 'dine_in', source: 'scan' } }); }}>
                    <span style={{ color: 'var(--text-light)' }}>扫码点餐: </span>
                    <span style={{ fontWeight: 600, textDecoration: 'underline', color: 'var(--red-primary)' }}>{stats.dineInScanCount}</span>
                  </div>
                  <div style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); openDetail({ title: '🧑‍💼 堂食收银点餐', icon: '🧑‍💼', filters: { type: 'dine_in', source: 'cashier' } }); }}>
                    <span style={{ color: 'var(--text-light)' }}>收银点餐: </span>
                    <span style={{ fontWeight: 600, textDecoration: 'underline', color: 'var(--red-primary)' }}>{stats.dineInCashierCount}</span>
                  </div>
                </div>
              </div>

              {/* Takeout card */}
              <div className="card" style={{ padding: 20, cursor: 'pointer', transition: 'box-shadow 0.2s' }}
                onClick={() => openDetail({ title: '🥡 外卖订单', icon: '🥡', filters: { type: 'takeout' } })}
                onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)')}
                onMouseLeave={e => (e.currentTarget.style.boxShadow = '')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <span style={{ fontSize: 24 }}>🥡</span>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--text-light)' }}>外卖订单</div>
                    <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--blue, #1976D2)' }}>{stats.takeoutCount}</div>
                  </div>
                </div>
              </div>

              {/* Phone card */}
              {stats.phoneCount > 0 && (
                <div className="card" style={{ padding: 20, cursor: 'pointer', transition: 'box-shadow 0.2s' }}
                  onClick={() => openDetail({ title: '📞 电话订单', icon: '📞', filters: { type: 'phone' } })}
                  onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)')}
                  onMouseLeave={e => (e.currentTarget.style.boxShadow = '')}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <span style={{ fontSize: 24 }}>📞</span>
                    <div>
                      <div style={{ fontSize: 12, color: 'var(--text-light)' }}>电话订单</div>
                      <div style={{ fontSize: 28, fontWeight: 700, color: '#7B1FA2' }}>{stats.phoneCount}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Top 20 Items */}
          {stats.topItems.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, color: 'var(--text-secondary)' }}>
                🏆 热销菜品 Top {stats.topItems.length}
              </h3>
              <div className="card" style={{ overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 500 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg)', borderBottom: '2px solid var(--border, #eee)' }}>
                      <th style={{ padding: '10px 12px', textAlign: 'center', width: 40 }}>#</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left' }}>菜品名称</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left' }}>English Name</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right' }}>销量</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right' }}>营收</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.topItems.map((item, idx) => (
                      <tr key={item.itemName} style={{ borderBottom: '1px solid #f0f0f0', cursor: 'pointer' }}
                        onClick={() => openItemOptions(item.itemName)}
                        onMouseEnter={e => (e.currentTarget.style.background = '#f5f5f5')}
                        onMouseLeave={e => (e.currentTarget.style.background = '')}>
                        <td style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 700, color: idx < 3 ? 'var(--red-primary)' : 'var(--text-light)' }}>{idx + 1}</td>
                        <td style={{ padding: '8px 12px', fontWeight: 600, textDecoration: 'underline' }}>{item.itemName}</td>
                        <td style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>{item.itemNameEn || '-'}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700 }}>{item.quantity}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: 'var(--red-primary)' }}>{euro(item.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Empty state */}
      {!stats && !loading && (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-light)' }}>
          <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.3 }}>📊</div>
          <p>选择日期范围查看营业报表</p>
        </div>
      )}

      {/* Detail Modal */}
      {modalConfig && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={closeModal}>
          <div style={{ background: '#fff', borderRadius: 16, width: '90%', maxWidth: 800, maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}>
            {/* Modal Header */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border, #eee)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700 }}>{modalConfig.title}</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  {modalConfig.filters.status === 'refunded'
                    ? `${modalOrders.length} 条订单 · 退单菜品 ${modalOrders.reduce((s, o) => s + o.items.filter(i => i.refunded).length, 0)} 项 · 退款 ${euro(modalOrders.reduce((s, o) => s + calcOrderRefund(o), 0))}`
                    : `共 ${modalOrders.length} 条 · 合计 ${euro(deduplicatedTotal(modalOrders))}`
                  }
                </span>
                <button onClick={closeModal} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-light)', padding: '0 4px' }}>✕</button>
              </div>
            </div>

            {/* Modal Body */}
            <div style={{ flex: 1, overflow: 'auto', padding: 0 }}>
              {modalLoading ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-light)' }}>加载中...</div>
              ) : modalOrders.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-light)' }}>
                  <div style={{ fontSize: 36, opacity: 0.3, marginBottom: 8 }}>📭</div>
                  <p>没有找到订单</p>
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg, #f9f9f9)', borderBottom: '2px solid var(--border, #eee)', position: 'sticky', top: 0 }}>
                      <th style={{ padding: '10px 12px', textAlign: 'left' }}>订单号</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left' }}>类型</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left' }}>菜品</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right' }}>金额</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left' }}>支付</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left' }}>时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modalOrders.map(o => {
                      const hasRefundedItems = o.items.some(i => i.refunded);
                      return (
                        <tr key={o._id} style={{ borderBottom: '1px solid #f0f0f0', background: hasRefundedItems ? '#FFF8E1' : undefined }}>
                          <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 600 }}>{orderNum(o)}</td>
                          <td style={{ padding: '8px 12px' }}>
                            <span style={{
                              display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                              background: o.type === 'dine_in' ? 'var(--red-light, #FFEBEE)' : '#E3F2FD',
                              color: o.type === 'dine_in' ? 'var(--red-primary)' : '#1976D2',
                            }}>{o.type === 'dine_in' ? '堂食' : '外卖'}</span>
                          </td>
                          <td style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-secondary)', maxWidth: 280 }}>
                            {o.items.map((i, idx) => (
                              <div key={idx} style={{ marginBottom: idx < o.items.length - 1 ? 4 : 0 }}>
                                <span style={{ textDecoration: i.refunded ? 'line-through' : 'none', color: i.refunded ? '#F44336' : undefined, fontWeight: 500 }}>
                                  {i.itemName}×{i.quantity}{i.refunded && ' ↩'}
                                </span>
                                {i.selectedOptions && i.selectedOptions.length > 0 && (
                                  <span style={{ fontSize: 11, color: 'var(--text-light)', marginLeft: 4 }}>
                                    ({i.selectedOptions.map((op) => `${op.choiceName || ''}${op.extraPrice ? ': €' + op.extraPrice : ''}`).filter(Boolean).join(', ')})
                                  </span>
                                )}
                              </div>
                            ))}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: 'var(--red-primary)' }}>{euro(orderTotal(o))}</td>
                          <td style={{ padding: '8px 12px', fontSize: 12 }}>{o.checkout?.paymentMethod || '-'}</td>
                          <td style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-light)' }}>{new Date(o.createdAt).toLocaleString()}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Item Option Stats Modal */}
      {(itemOptionStats || itemOptionLoading) && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setItemOptionStats(null)}>
          <div style={{ background: '#fff', borderRadius: 16, width: '90%', maxWidth: 500, maxHeight: '80vh', overflow: 'auto', padding: 24 }}
            onClick={e => e.stopPropagation()}>
            {itemOptionLoading ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-light)' }}>加载中...</div>
            ) : itemOptionStats && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700 }}>⚙ {itemOptionStats.itemName}</h3>
                  <button onClick={() => setItemOptionStats(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-light)' }}>✕</button>
                </div>
                <div style={{ display: 'flex', gap: 16, marginBottom: 16, fontSize: 13 }}>
                  <div><span style={{ color: 'var(--text-light)' }}>总销量: </span><span style={{ fontWeight: 700 }}>{itemOptionStats.totalSold}</span></div>
                  <div><span style={{ color: 'var(--text-light)' }}>付费选项: </span><span style={{ fontWeight: 700 }}>{itemOptionStats.withPaidOptions}</span> ({itemOptionStats.totalSold > 0 ? Math.round(itemOptionStats.withPaidOptions / itemOptionStats.totalSold * 100) : 0}%)</div>
                  <div><span style={{ color: 'var(--text-light)' }}>选项收入: </span><span style={{ fontWeight: 700, color: 'var(--red-primary)' }}>{euro(itemOptionStats.totalOptionRevenue)}</span></div>
                </div>
                {itemOptionStats.options.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-light)' }}>无选项数据（该菜品在订单中未带选项快照）</div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: 'var(--bg)', borderBottom: '2px solid var(--border)' }}>
                        <th style={{ padding: '8px 10px', textAlign: 'left' }}>选项组</th>
                        <th style={{ padding: '8px 10px', textAlign: 'left' }}>选择</th>
                        <th style={{ padding: '8px 10px', textAlign: 'right' }}>单价</th>
                        <th style={{ padding: '8px 10px', textAlign: 'right' }}>次数</th>
                        <th style={{ padding: '8px 10px', textAlign: 'right' }}>收入</th>
                      </tr>
                    </thead>
                    <tbody>
                      {itemOptionStats.options.map((opt, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid #f0f0f0' }}>
                          <td style={{ padding: '6px 10px', color: 'var(--text-secondary)' }}>{opt.groupName}</td>
                          <td style={{ padding: '6px 10px', fontWeight: 600 }}>{opt.choiceName}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'right' }}>+€{opt.extraPrice}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700 }}>{opt.count}x</td>
                          <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700, color: 'var(--red-primary)' }}>{euro(opt.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label, value, color, icon, onClick,
}: {
  label: string; value: string; color: string; icon: string; onClick?: () => void;
}) {
  return (
    <div className="card" style={{ padding: 20, textAlign: 'center', cursor: onClick ? 'pointer' : 'default', transition: 'box-shadow 0.2s' }}
      onClick={onClick}
      onMouseEnter={e => { if (onClick) e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)'; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = ''; }}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: 12, color: 'var(--text-light)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color, fontFamily: "'Noto Serif SC', serif" }}>{value}</div>
      {onClick && <div style={{ fontSize: 10, color: 'var(--text-light)', marginTop: 6 }}>点击查看详情 →</div>}
    </div>
  );
}
