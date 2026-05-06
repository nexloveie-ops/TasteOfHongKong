import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { io } from 'socket.io-client';
import { useAuth } from '../../context/AuthContext';
import { apiFetch } from '../../api/client';
import { buildReceiptHTML, printViaIframe } from '../../components/cashier/ReceiptPrint';

type OrderType = 'dine_in' | 'takeout' | 'phone' | 'delivery';
type OrderStatus = 'pending' | 'paid_online' | 'checked_out' | 'completed' | 'refunded' | 'checked_out-hide' | 'completed-hide';
type DeliveryStage = 'new' | 'accepted' | 'picked_up_by_driver' | 'out_for_delivery';

interface OrderRow {
  _id: string;
  type: OrderType;
  status: OrderStatus;
  dailyOrderNumber?: number;
  tableNumber?: number;
  seatNumber?: number;
  customerName?: string;
  customerPhone?: string;
  deliveryAddress?: string;
  postalCode?: string;
  deliverySource?: 'phone' | 'qr';
  deliveryStage?: DeliveryStage;
  items: { _id: string; quantity: number; unitPrice: number; itemName: string; selectedOptions?: { extraPrice?: number }[] }[];
  appliedBundles?: { discount: number }[];
  createdAt: string;
}

interface RestaurantConfig {
  restaurant_name_en?: string;
  restaurant_name_zh?: string;
  restaurant_address?: string;
  restaurant_phone?: string;
  restaurant_website?: string;
  restaurant_email?: string;
  receipt_terms?: string;
  receipt_print_copies?: string;
}

function calcTotal(order: OrderRow): number {
  const itemTotal = order.items.reduce((sum, item) => {
    const extra = (item.selectedOptions || []).reduce((s, o) => s + (o.extraPrice || 0), 0);
    return sum + (item.unitPrice + extra) * item.quantity;
  }, 0);
  const disc = (order.appliedBundles || []).reduce((s, b) => s + b.discount, 0);
  return itemTotal - disc;
}

export default function UnifiedOrderCenter() {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language?.startsWith('en');
  const { token, user, hasFeature } = useAuth();
  const canDelivery = hasFeature('cashier.delivery.page');
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [config, setConfig] = useState<RestaurantConfig>({});
  const [loadHint, setLoadHint] = useState('');
  const [queueMode, setQueueMode] = useState<'unified' | 'fallback'>('unified');
  const [checkoutModalOrder, setCheckoutModalOrder] = useState<OrderRow | null>(null);
  const [checkoutModalTable, setCheckoutModalTable] = useState<{ tableNumber: number; orders: OrderRow[] } | null>(null);
  const [detailModalOrder, setDetailModalOrder] = useState<OrderRow | null>(null);
  const [checkoutMethod, setCheckoutMethod] = useState<'cash' | 'card' | 'mixed'>('cash');
  const [cashReceived, setCashReceived] = useState('');
  const [mixedCash, setMixedCash] = useState('');
  const [mixedCard, setMixedCard] = useState('');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const cfgReq = apiFetch('/api/admin/config');
      const ordersRes = await apiFetch('/api/orders/active-all', { headers: { Authorization: `Bearer ${token}` } });
      if (ordersRes.ok) {
        setOrders(await ordersRes.json());
        setLoadHint('');
        setQueueMode('unified');
      } else {
        // Backward-compatible fallback: if backend hasn't restarted yet, aggregate from legacy endpoints.
        const [dineInRes, takeoutRes, phoneRes] = await Promise.all([
          apiFetch('/api/orders/dine-in', { headers: { Authorization: `Bearer ${token}` } }),
          apiFetch('/api/orders/takeout', { headers: { Authorization: `Bearer ${token}` } }),
          apiFetch('/api/orders/phone', { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        const merged: OrderRow[] = [];
        if (dineInRes.ok) merged.push(...await dineInRes.json() as OrderRow[]);
        if (takeoutRes.ok) merged.push(...await takeoutRes.json() as OrderRow[]);
        if (phoneRes.ok) merged.push(...await phoneRes.json() as OrderRow[]);
        setOrders(merged);
        setLoadHint('当前后端未提供统一队列接口，已回退旧接口展示（delivery 可能不完整）。请重启后端以启用完整订单中心。');
        setQueueMode('fallback');
      }
      const cfgRes = await cfgReq;
      if (cfgRes.ok) setConfig(await cfgRes.json());
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  useEffect(() => {
    const query = user?.storeId ? { storeId: user.storeId } : {};
    const socket = io({ transports: ['websocket'], query });
    socket.on('order:new', fetchAll);
    socket.on('order:updated', fetchAll);
    socket.on('order:checked-out', fetchAll);
    socket.on('order:cancelled', fetchAll);
    return () => { socket.disconnect(); };
  }, [fetchAll, user?.storeId]);

  const printCheckout = useCallback(async (checkoutId: string, opts?: { cashReceived?: number; changeAmount?: number }) => {
    const receiptRes = await apiFetch(`/api/checkout/receipt/${checkoutId}`);
    if (!receiptRes.ok) return;
    const receipt = await receiptRes.json();
    const html = buildReceiptHTML(receipt, config, opts?.cashReceived, opts?.changeAmount);
    printViaIframe(html, 1);
  }, [config]);

  const checkoutSeat = useCallback(async (
    order: OrderRow,
    paymentMethod: 'cash' | 'card' | 'mixed',
    mixed?: { cashAmount: number; cardAmount: number },
    cashMeta?: { cashReceived: number; changeAmount: number },
  ) => {
    setBusyId(order._id);
    try {
      const total = calcTotal(order);
      const body: Record<string, unknown> = { paymentMethod };
      if (paymentMethod === 'cash') body.cashAmount = total;
      if (paymentMethod === 'card') body.cardAmount = total;
      if (paymentMethod === 'mixed' && mixed) {
        body.cashAmount = mixed.cashAmount;
        body.cardAmount = mixed.cardAmount;
      }
      const res = await apiFetch(`/api/checkout/seat/${order._id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?._id) await printCheckout(String(data._id), cashMeta);
        await fetchAll();
      }
    } finally {
      setBusyId(null);
    }
  }, [fetchAll, printCheckout, token]);

  const checkoutTable = useCallback(async (
    tableNumber: number,
    paymentMethod: 'cash' | 'card' | 'mixed',
    mixed?: { cashAmount: number; cardAmount: number },
    cashMeta?: { cashReceived: number; changeAmount: number },
  ) => {
    const busyKey = `table-${tableNumber}`;
    setBusyId(busyKey);
    try {
      const tableOrders = orders.filter((o) => o.type === 'dine_in' && o.tableNumber === tableNumber && o.status === 'pending');
      const total = tableOrders.reduce((sum, o) => sum + calcTotal(o), 0);
      const body: Record<string, unknown> = { paymentMethod };
      if (paymentMethod === 'cash') body.cashAmount = total;
      if (paymentMethod === 'card') body.cardAmount = total;
      if (paymentMethod === 'mixed' && mixed) {
        body.cashAmount = mixed.cashAmount;
        body.cardAmount = mixed.cardAmount;
      }
      const res = await apiFetch(`/api/checkout/table/${tableNumber}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?._id) await printCheckout(String(data._id), cashMeta);
        await fetchAll();
      }
    } finally {
      setBusyId(null);
    }
  }, [fetchAll, orders, printCheckout, token]);

  const openCheckoutModal = (order: OrderRow) => {
    setCheckoutModalOrder(order);
    setCheckoutModalTable(null);
    setCheckoutMethod('cash');
    setCashReceived('');
    setMixedCash('');
    setMixedCard('');
  };

  const openTableCheckoutModal = (tableNumber: number, tableOrders: OrderRow[]) => {
    setCheckoutModalOrder(null);
    setCheckoutModalTable({ tableNumber, orders: tableOrders });
    setCheckoutMethod('cash');
    setCashReceived('');
    setMixedCash('');
    setMixedCard('');
  };

  const submitCheckoutModal = async () => {
    const targetOrder = checkoutModalOrder;
    const targetTable = checkoutModalTable;
    if (!targetOrder && !targetTable) return;
    const total = targetOrder ? calcTotal(targetOrder) : (targetTable?.orders.reduce((sum, o) => sum + calcTotal(o), 0) || 0);
    if (checkoutMethod === 'mixed') {
      const cash = Number(mixedCash) || 0;
      const card = Number(mixedCard) || 0;
      if (cash <= 0 || card <= 0) {
        alert('混合支付需填写现金和刷卡金额');
        return;
      }
      if (Math.abs(cash + card - total) > 0.001) {
        alert(`混合支付金额不匹配，应等于 €${total.toFixed(2)}`);
        return;
      }
      if (targetOrder) {
        await checkoutSeat(targetOrder, 'mixed', { cashAmount: cash, cardAmount: card });
      } else if (targetTable) {
        await checkoutTable(targetTable.tableNumber, 'mixed', { cashAmount: cash, cardAmount: card });
      }
      setCheckoutModalOrder(null);
      setCheckoutModalTable(null);
      return;
    }
    if (checkoutMethod === 'cash') {
      const paid = Number(cashReceived) || 0;
      if (paid <= 0) {
        alert('请先输入客人支付金额');
        return;
      }
      if (paid < total) {
        alert(`实收金额不足，应至少 €${total.toFixed(2)}`);
        return;
      }
      const changeAmount = Math.max(0, paid - total);
      if (targetOrder) {
        await checkoutSeat(targetOrder, 'cash', undefined, { cashReceived: paid, changeAmount });
      } else if (targetTable) {
        await checkoutTable(targetTable.tableNumber, 'cash', undefined, { cashReceived: paid, changeAmount });
      }
      setCheckoutModalOrder(null);
      setCheckoutModalTable(null);
      return;
    }
    if (targetOrder) {
      await checkoutSeat(targetOrder, checkoutMethod);
    } else if (targetTable) {
      await checkoutTable(targetTable.tableNumber, checkoutMethod);
    }
    setCheckoutModalOrder(null);
    setCheckoutModalTable(null);
  };

  const cancelPending = useCallback(async (orderId: string) => {
    if (!confirm('确认取消该订单？')) return;
    setBusyId(orderId);
    try {
      await apiFetch(`/api/orders/${orderId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      await fetchAll();
    } finally {
      setBusyId(null);
    }
  }, [fetchAll, token]);

  const completeTakeout = useCallback(async (orderId: string) => {
    setBusyId(orderId);
    try {
      await apiFetch(`/api/orders/takeout/${orderId}/complete`, { method: 'PUT', headers: { Authorization: `Bearer ${token}` } });
      await fetchAll();
    } finally {
      setBusyId(null);
    }
  }, [fetchAll, token]);

  const setDeliveryStage = useCallback(async (orderId: string, stage: DeliveryStage) => {
    setBusyId(orderId);
    try {
      await apiFetch(`/api/orders/${orderId}/delivery-stage`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ deliveryStage: stage }),
      });
      await fetchAll();
    } finally {
      setBusyId(null);
    }
  }, [fetchAll, token]);

  const printDeliveryPrepTicket = useCallback((order: OrderRow) => {
    const now = new Date();
    const rows = order.items.map((i) => {
      const extra = (i.selectedOptions || []).reduce((s, o) => s + (o.extraPrice || 0), 0);
      return `<div style="display:flex;justify-content:space-between;margin:4px 0;"><span>${i.itemName} x${i.quantity}</span><span>€${((i.unitPrice + extra) * i.quantity).toFixed(2)}</span></div>`;
    }).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Delivery Prep</title></head><body style="font-family:Arial,sans-serif;padding:14px;max-width:380px;margin:0 auto;">
      <h2 style="margin:0 0 6px;">送餐备餐单</h2>
      <div style="font-size:12px;color:#555;margin-bottom:6px;">#${order.dailyOrderNumber ?? '--'} · ${now.toLocaleString()}</div>
      <div style="font-size:12px;margin-bottom:6px;">${order.customerName || ''} · ${order.customerPhone || ''}</div>
      <div style="font-size:12px;margin-bottom:8px;">${order.deliveryAddress || ''} ${order.postalCode || ''}</div>
      <hr/>
      ${rows}
      <hr/>
      <div style="display:flex;justify-content:space-between;font-weight:700;"><span>合计</span><span>€${calcTotal(order).toFixed(2)}</span></div>
    </body></html>`;
    printViaIframe(html, 1);
  }, []);

  const printOrderTicket = useCallback((order: OrderRow) => {
    const receiptOrderType = order.type === 'delivery' ? 'phone' : order.type;
    const receiptItems = order.items.map((item) => ({
      _id: item._id,
      menuItemId: item._id,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      itemName: item.itemName,
      selectedOptions: (item.selectedOptions || []).map((opt) => ({
        groupName: '',
        choiceName: '',
        extraPrice: opt.extraPrice || 0,
      })),
    }));
    const receiptData = {
      checkoutId: order._id,
      type: 'seat' as const,
      totalAmount: calcTotal(order),
      paymentMethod: order.status === 'paid_online' ? 'online' as const : 'cash' as const,
      checkedOutAt: new Date().toISOString(),
      tableNumber: order.tableNumber,
      orders: [{
        _id: order._id,
        type: receiptOrderType,
        seatNumber: order.seatNumber,
        dailyOrderNumber: order.dailyOrderNumber,
        status: order.status,
        items: receiptItems,
      }],
    };
    const html = buildReceiptHTML(receiptData, config);
    printViaIframe(html, 1);
  }, [config]);

  const handleDeliveryPrintAndCook = useCallback(async (order: OrderRow) => {
    printDeliveryPrepTicket(order);
    await setDeliveryStage(order._id, 'accepted');
  }, [printDeliveryPrepTicket, setDeliveryStage]);

  const handleDeliveryDriverPickup = useCallback(async (order: OrderRow) => {
    await setDeliveryStage(order._id, 'picked_up_by_driver');
  }, [setDeliveryStage]);

  const grouped = useMemo(() => {
    const byType: Record<OrderType, OrderRow[]> = { dine_in: [], takeout: [], phone: [], delivery: [] };
    for (const o of orders) {
      if (o.type === 'dine_in' && o.status === 'checked_out') continue;
      if (o.type === 'delivery' && (!canDelivery || o.status === 'checked_out')) continue;
      byType[o.type].push(o);
    }
    return byType;
  }, [orders, canDelivery]);

  const dineInByTable = useMemo(() => {
    const map = new Map<number, OrderRow[]>();
    for (const o of grouped.dine_in) {
      const tableNo = o.tableNumber ?? -1;
      if (!map.has(tableNo)) map.set(tableNo, []);
      map.get(tableNo)!.push(o);
    }
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([tableNumber, tableOrders]) => ({
        tableNumber,
        orders: tableOrders.sort((a, b) => (a.seatNumber ?? 0) - (b.seatNumber ?? 0)),
        pendingOrders: tableOrders.filter((o) => o.status === 'pending'),
      }));
  }, [grouped.dine_in]);

  const L = {
    title: isEn ? 'Order Center' : '订单中心',
    refresh: isEn ? 'Refresh' : '刷新',
    refreshing: isEn ? 'Refreshing…' : '刷新中…',
    unifiedMode: isEn ? 'Unified API Mode' : '统一接口模式',
    fallbackMode: isEn ? 'Fallback Mode' : '回退模式',
    empty: isEn ? 'No orders' : '暂无',
    paymentAndPrint: isEn ? 'Payment & Printing' : '收款与出单',
    deliveryStage: isEn ? 'Delivery Stage' : '配送阶段',
    checkout: isEn ? 'Checkout' : '结账',
    cancel: isEn ? 'Cancel' : '取消',
    markComplete: isEn ? 'Mark Complete' : '标记完成',
    printAndComplete: isEn ? 'Print & Complete' : '打印并完成',
    processing: isEn ? 'Processing…' : '处理中…',
    checkoutModalTitle: isEn ? 'Order Checkout' : '订单结账',
    total: isEn ? 'Total' : '合计',
    cash: isEn ? 'Cash' : '现金',
    card: isEn ? 'Card' : '刷卡',
    mixed: isEn ? 'Mixed' : '混合',
    cashAmount: isEn ? 'Cash amount' : '现金金额',
    cardAmount: isEn ? 'Card amount' : '刷卡金额',
    paidAmount: isEn ? 'Amount paid by customer' : '客人支付金额',
    change: isEn ? 'Change' : '找零',
    confirmCheckout: isEn ? 'Confirm Checkout' : '确认结账',
    deliverySource: isEn ? 'Source' : '来源',
    stage: isEn ? 'Stage' : '阶段',
    printAndCook: isEn ? 'Print Ticket & Start Cooking' : '打印小票并开始制作',
    driverPickedUp: isEn ? 'Driver Picked Up' : '司机取走',
    waitDriverCash: isEn ? 'Driver picked up. Wait for driver to return and pay; payment completes the order.' : '司机已取走，等待司机回店结账；结账即完成订单。',
    cashierCollectHint: isEn ? 'Cashier collects payment after driver returns. Payment means delivered and completed.' : '司机回店后由 cashier 收款；收款即代表已送达并完成。',
    detailsTitle: isEn ? 'Order Details' : '订单详情',
    status: isEn ? 'Status' : '状态',
    customer: isEn ? 'Customer' : '客户',
    address: isEn ? 'Address' : '地址',
    postalCode: isEn ? 'Postal Code' : '邮编',
    items: isEn ? 'Items' : '菜品',
    clickToView: isEn ? 'Click to view details' : '点击查看详情',
    printReceipt: isEn ? 'Print Ticket' : '打印小票',
    tableCheckout: isEn ? 'Checkout Table' : '按桌结账',
    seatCheckout: isEn ? 'Checkout Seat' : '按座结账',
    tableLabel: isEn ? 'Table' : '桌号',
    seatsLabel: isEn ? 'Seats' : '座位数',
  } as const;

  const deliverySourceLabel = (source?: OrderRow['deliverySource']) => {
    if (source === 'phone') return isEn ? 'Phone' : '电话';
    if (source === 'qr') return 'QR';
    return '-';
  };

  const deliveryStageLabel = (stage?: DeliveryStage) => {
    if (!stage || stage === 'new') return isEn ? 'New' : '新单';
    if (stage === 'accepted') return isEn ? 'Accepted' : '已接单';
    if (stage === 'picked_up_by_driver') return L.driverPickedUp;
    if (stage === 'out_for_delivery') return isEn ? 'Out for Delivery' : '配送中';
    return stage;
  };

  const typeLabel: Record<OrderType, string> = {
    dine_in: isEn ? 'Dine-in Orders' : '堂食订单',
    takeout: isEn ? 'Takeout' : '外卖自提',
    phone: isEn ? 'Phone Orders' : '电话订单',
    delivery: isEn ? 'Delivery Orders' : '送餐订单',
  };

  const statusStyle = (status: OrderStatus): { bg: string; fg: string } => {
    if (status === 'pending') return { bg: '#fff3e0', fg: '#e65100' };
    if (status === 'paid_online') return { bg: '#e3f2fd', fg: '#1565c0' };
    if (status === 'checked_out') return { bg: '#e8f5e9', fg: '#1b5e20' };
    if (status === 'completed') return { bg: '#ede7f6', fg: '#4527a0' };
    return { bg: '#f5f5f5', fg: '#424242' };
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>{L.title}</h2>
          <span
            title={queueMode === 'unified' ? '已连接统一订单接口 /api/orders/active-all' : '后端暂未提供统一订单接口，使用旧接口回退'}
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.2,
              padding: '3px 8px',
              borderRadius: 999,
              border: queueMode === 'unified' ? '1px solid #a5d6a7' : '1px solid #ffcc80',
              color: queueMode === 'unified' ? '#1b5e20' : '#8d6e63',
              background: queueMode === 'unified' ? '#e8f5e9' : '#fff8e1',
            }}
          >
            {queueMode === 'unified' ? L.unifiedMode : L.fallbackMode}
          </span>
        </div>
        <button className="btn btn-outline" onClick={() => void fetchAll()}>{loading ? L.refreshing : L.refresh}</button>
      </div>
      {loadHint ? (
        <div style={{ padding: '8px 10px', border: '1px solid #ffe0b2', borderRadius: 8, background: '#fff8e1', fontSize: 12, color: '#8d6e63' }}>
          {loadHint}
        </div>
      ) : null}

      {(Object.keys(grouped) as OrderType[]).filter((type) => canDelivery || type !== 'delivery').map((type) => (
        <section key={type} style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 12, padding: 12 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>{typeLabel[type]} ({grouped[type].length})</h3>
          {type === 'dine_in' ? (
            dineInByTable.length === 0 ? (
              <div style={{ color: 'var(--text-light)', fontSize: 13 }}>{L.empty}</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                {dineInByTable.map((tableGroup) => {
                  const tableTotal = tableGroup.pendingOrders.reduce((sum, o) => sum + calcTotal(o), 0);
                  return (
                    <div key={`table-${tableGroup.tableNumber}`} style={{ border: '1px solid #eee', borderRadius: 8, padding: 8, background: '#fafafa' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>
                          {L.tableLabel} {tableGroup.tableNumber} · {L.seatsLabel} {tableGroup.orders.length}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ fontSize: 11, color: '#666' }}>€{tableTotal.toFixed(2)}</span>
                          <button
                            className="btn btn-primary"
                            style={{ fontSize: 11, padding: '4px 8px', lineHeight: 1.2 }}
                            disabled={tableGroup.pendingOrders.length === 0 || busyId === `table-${tableGroup.tableNumber}`}
                            onClick={() => openTableCheckoutModal(tableGroup.tableNumber, tableGroup.pendingOrders)}
                          >
                            {busyId === `table-${tableGroup.tableNumber}` ? L.processing : L.tableCheckout}
                          </button>
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 6 }}>
                        {tableGroup.orders.map((o) => (
                          <div
                            key={o._id}
                            onClick={() => setDetailModalOrder(o)}
                            title={L.clickToView}
                            style={{ border: '1px solid #e8e8e8', borderRadius: 7, background: '#fff', padding: 7, cursor: 'pointer' }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                              <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
                                <span>座 {o.seatNumber ?? '-'}</span>
                                <button
                                  className="btn btn-outline"
                                  style={{ fontSize: 10, padding: '1px 6px', lineHeight: 1.1 }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    printOrderTicket(o);
                                  }}
                                  title={L.printReceipt}
                                >
                                  🖨
                                </button>
                              </div>
                              <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 10, background: '#eee' }}>{o.status}</span>
                            </div>
                            <div style={{ fontSize: 11, color: '#666', marginBottom: 6 }}>
                              {o.items.length} items · €{calcTotal(o).toFixed(2)}
                            </div>
                            <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 5 }}>
                              {o.status === 'pending' ? (
                                <button className="btn btn-outline" style={{ fontSize: 11, padding: '4px 8px', lineHeight: 1.2 }} disabled={busyId === o._id} onClick={() => openCheckoutModal(o)}>
                                  {L.seatCheckout}
                                </button>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : grouped[type].length === 0 ? (
            <div style={{ color: 'var(--text-light)', fontSize: 13 }}>{L.empty}</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10 }}>
              {grouped[type].map((o) => (
                <div
                  key={o._id}
                  onClick={() => setDetailModalOrder(o)}
                  style={{ border: '1px solid #eee', borderRadius: 10, padding: 10, background: '#fafafa', cursor: 'pointer' }}
                  title={L.clickToView}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span>{o.type === 'dine_in' ? `桌 ${o.tableNumber ?? '-'} / 座 ${o.seatNumber ?? '-'}` : `#${o.dailyOrderNumber ?? '--'}`}</span>
                      <button
                        className="btn btn-outline"
                        style={{ fontSize: 11, padding: '2px 8px', lineHeight: 1.2 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          printOrderTicket(o);
                        }}
                        title={L.printReceipt}
                      >
                        🖨 {L.printReceipt}
                      </button>
                    </div>
                    <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 12, background: '#eee' }}>{o.status}</span>
                  </div>
                  {o.type === 'delivery' ? (
                    <div style={{ fontSize: 12, color: '#555', marginBottom: 6, lineHeight: 1.5 }}>
                      <div>{o.customerName} · {o.customerPhone}</div>
                      <div>
                        {L.deliverySource}：{deliverySourceLabel(o.deliverySource)} · {L.stage}：{deliveryStageLabel(o.deliveryStage)}
                      </div>
                    </div>
                  ) : null}
                  <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
                    {o.items.length} items · €{calcTotal(o).toFixed(2)}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} onClick={(e) => e.stopPropagation()}>
                    {o.type === 'delivery' ? (
                      <div style={{ padding: 8, border: '1px solid #e6e6e6', borderRadius: 8, background: '#fff' }}>
                        <div style={{ fontSize: 11, color: '#666', marginBottom: 6, fontWeight: 600 }}>{L.deliveryStage}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {(!o.deliveryStage || o.deliveryStage === 'new') ? (
                            <button
                              className="btn btn-outline"
                              style={{ fontSize: 12 }}
                              disabled={busyId === o._id}
                              onClick={() => void handleDeliveryPrintAndCook(o)}
                            >
                              {L.printAndCook}
                            </button>
                          ) : null}
                          {o.deliveryStage === 'accepted' ? (
                            <button
                              className="btn btn-outline"
                              style={{ fontSize: 12 }}
                              disabled={busyId === o._id}
                              onClick={() => void handleDeliveryDriverPickup(o)}
                            >
                              {L.driverPickedUp}
                            </button>
                          ) : null}
                          {o.deliveryStage === 'picked_up_by_driver' && o.status === 'pending' ? (
                            <span style={{ fontSize: 11, color: '#666', alignSelf: 'center' }}>{L.waitDriverCash}</span>
                          ) : null}
                        </div>
                      </div>
                    ) : null}

                    {o.type !== 'delivery' || (
                      (o.deliveryStage === 'picked_up_by_driver' && o.status === 'pending')
                    ) ? (
                      <div style={{ padding: 8, border: '1px solid #e6e6e6', borderRadius: 8, background: '#fff' }}>
                        <div style={{ fontSize: 11, color: '#666', marginBottom: 6, fontWeight: 600 }}>{L.paymentAndPrint}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {o.status === 'pending' ? (
                            <>
                              <button className="btn btn-primary" style={{ fontSize: 12 }} disabled={busyId === o._id} onClick={() => openCheckoutModal(o)}>{L.checkout}</button>
                              <button className="btn btn-ghost" style={{ fontSize: 12, color: 'var(--red-primary)' }} disabled={busyId === o._id} onClick={() => void cancelPending(o._id)}>{L.cancel}</button>
                            </>
                          ) : null}
                          {o.type === 'takeout' && o.status === 'checked_out' ? (
                            <button className="btn btn-primary" style={{ fontSize: 12 }} disabled={busyId === o._id} onClick={() => void completeTakeout(o._id)}>{L.markComplete}</button>
                          ) : null}
                        </div>
                        {o.type === 'delivery' ? (
                          <div style={{ fontSize: 11, color: '#666', marginTop: 6 }}>{L.cashierCollectHint}</div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
      <div style={{ fontSize: 12, color: 'var(--text-light)' }}>{t('cashier.noOrders')}</div>
      {checkoutModalOrder || checkoutModalTable ? (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 380, maxWidth: '92vw', background: '#fff', borderRadius: 12, padding: 16 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>{L.checkoutModalTitle}</h3>
            <div style={{ fontSize: 13, color: '#666', marginBottom: 10 }}>
              {checkoutModalOrder
                ? `#${checkoutModalOrder.dailyOrderNumber ?? '--'} · ${L.total} €${calcTotal(checkoutModalOrder).toFixed(2)}`
                : `${L.tableLabel} ${checkoutModalTable?.tableNumber ?? '-'} · ${L.total} €${(checkoutModalTable?.orders.reduce((sum, o) => sum + calcTotal(o), 0) || 0).toFixed(2)}`
              }
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              {(['cash', 'card', 'mixed'] as const).map((m) => (
                <button
                  key={m}
                  className="btn"
                  onClick={() => setCheckoutMethod(m)}
                  style={{
                    flex: 1,
                    fontSize: 12,
                    background: checkoutMethod === m ? 'var(--red-primary)' : '#f5f5f5',
                    color: checkoutMethod === m ? '#fff' : '#444',
                  }}
                >
                  {m === 'cash' ? L.cash : m === 'card' ? L.card : L.mixed}
                </button>
              ))}
            </div>
            {checkoutMethod === 'mixed' ? (
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <input className="input" type="number" placeholder={L.cashAmount} value={mixedCash} onChange={e => setMixedCash(e.target.value)} />
                <input className="input" type="number" placeholder={L.cardAmount} value={mixedCard} onChange={e => setMixedCard(e.target.value)} />
              </div>
            ) : null}
            {checkoutMethod === 'cash' ? (
              <div style={{ marginBottom: 10 }}>
                <input className="input" type="number" placeholder={L.paidAmount} value={cashReceived} onChange={e => setCashReceived(e.target.value)} />
                {(Number(cashReceived) || 0) > 0 ? (
                  <div style={{ marginTop: 6, fontSize: 12, color: (Number(cashReceived) || 0) >= (checkoutModalOrder ? calcTotal(checkoutModalOrder) : (checkoutModalTable?.orders.reduce((sum, o) => sum + calcTotal(o), 0) || 0)) ? '#2e7d32' : '#c62828' }}>
                    {L.change}：€{Math.max(0, (Number(cashReceived) || 0) - (checkoutModalOrder ? calcTotal(checkoutModalOrder) : (checkoutModalTable?.orders.reduce((sum, o) => sum + calcTotal(o), 0) || 0))).toFixed(2)}
                  </div>
                ) : null}
              </div>
            ) : null}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-outline" onClick={() => { setCheckoutModalOrder(null); setCheckoutModalTable(null); }}>{L.cancel}</button>
              <button className="btn btn-primary" disabled={busyId === (checkoutModalOrder?._id || `table-${checkoutModalTable?.tableNumber ?? '-'}`)} onClick={() => void submitCheckoutModal()}>
                {busyId === (checkoutModalOrder?._id || `table-${checkoutModalTable?.tableNumber ?? '-'}`) ? L.processing : L.confirmCheckout}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {detailModalOrder ? (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 460, maxWidth: '94vw', background: '#fff', borderRadius: 12, padding: 16, maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700 }}>{L.detailsTitle}</h3>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  padding: '4px 10px',
                  borderRadius: 999,
                  background: statusStyle(detailModalOrder.status).bg,
                  color: statusStyle(detailModalOrder.status).fg,
                }}
              >
                {detailModalOrder.status}
              </span>
            </div>

            <div style={{ border: '1px solid #eee', borderRadius: 10, padding: 10, marginBottom: 10, background: '#fafafa' }}>
              <div style={{ fontSize: 14, color: '#222', fontWeight: 700, marginBottom: 4 }}>
                #{detailModalOrder.dailyOrderNumber ?? '--'} · {typeLabel[detailModalOrder.type]}
              </div>
              <div style={{ fontSize: 12, color: '#777' }}>
                {new Date(detailModalOrder.createdAt).toLocaleString()}
              </div>
            </div>

            {detailModalOrder.type === 'dine_in' ? (
              <div style={{ border: '1px solid #eee', borderRadius: 10, padding: 10, marginBottom: 10 }}>
                <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>桌台信息</div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  桌 {detailModalOrder.tableNumber ?? '-'} / 座 {detailModalOrder.seatNumber ?? '-'}
                </div>
              </div>
            ) : null}
            {detailModalOrder.type === 'delivery' ? (
              <div style={{ border: '1px solid #eee', borderRadius: 10, padding: 10, marginBottom: 10, lineHeight: 1.6 }}>
                <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>配送信息</div>
                <div style={{ fontSize: 13 }}>{L.customer}: {detailModalOrder.customerName || '-'} · {detailModalOrder.customerPhone || '-'}</div>
                <div style={{ fontSize: 13 }}>{L.address}: {detailModalOrder.deliveryAddress || '-'}</div>
                <div style={{ fontSize: 13 }}>{L.postalCode}: {detailModalOrder.postalCode || '-'}</div>
                <div style={{ fontSize: 13 }}>{L.deliverySource}: {deliverySourceLabel(detailModalOrder.deliverySource)} · {L.stage}: {deliveryStageLabel(detailModalOrder.deliveryStage)}</div>
              </div>
            ) : null}
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>{L.items}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10, border: '1px solid #eee', borderRadius: 10, padding: 10 }}>
              {detailModalOrder.items.map((item) => (
                <div key={item._id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, paddingBottom: 6, borderBottom: '1px dashed #f0f0f0' }}>
                  <span style={{ color: '#333' }}>{item.itemName} x{item.quantity}</span>
                  <span style={{ fontWeight: 600 }}>€{((item.unitPrice + (item.selectedOptions || []).reduce((s, o) => s + (o.extraPrice || 0), 0)) * item.quantity).toFixed(2)}</span>
                </div>
              ))}
            </div>
            <div style={{ background: '#fff7f7', border: '1px solid #ffdfe0', borderRadius: 10, padding: 10, marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: '#666' }}>{L.total}</span>
              <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--red-primary)' }}>€{calcTotal(detailModalOrder).toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-outline" onClick={() => setDetailModalOrder(null)}>{L.cancel}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
