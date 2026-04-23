import { useEffect, useState, useRef, useCallback } from 'react';

interface ReceiptOrderItem {
  _id: string;
  menuItemId: string;
  quantity: number;
  unitPrice: number;
  itemName: string;
  itemNameEn?: string;
  selectedOptions?: { groupName: string; choiceName: string; extraPrice: number }[];
}

interface ReceiptOrder {
  _id: string;
  type: 'dine_in' | 'takeout' | 'phone';
  tableNumber?: number;
  seatNumber?: number;
  dailyOrderNumber?: number;
  dineInOrderNumber?: string;
  status: string;
  items: ReceiptOrderItem[];
}

interface ReceiptData {
  checkoutId: string;
  type: 'table' | 'seat';
  tableNumber?: number;
  totalAmount: number;
  paymentMethod: 'cash' | 'card' | 'mixed';
  cashAmount?: number;
  cardAmount?: number;
  checkedOutAt: string;
  orders: ReceiptOrder[];
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

export interface BundleDiscountInfo {
  name: string;
  nameEn: string;
  discount: number;
}

interface ReceiptPrintProps {
  checkoutId: string;
  cashReceived?: number;
  changeAmount?: number;
  bundleDiscounts?: BundleDiscountInfo[];
  printCopies?: number;
}

function parseQRCodes(text: string): Array<{ type: 'text' | 'qr'; value: string }> {
  const segments: Array<{ type: 'text' | 'qr'; value: string }> = [];
  const regex = /\[QR:(.*?)\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) segments.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    segments.push({ type: 'qr', value: match[1] });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) segments.push({ type: 'text', value: text.slice(lastIndex) });
  return segments;
}

/** Build standalone receipt HTML for iframe printing */
function buildReceiptHTML(
  receipt: ReceiptData,
  config: RestaurantConfig,
  cashReceived?: number,
  changeAmount?: number,
  bundleDiscounts?: BundleDiscountInfo[],
): string {
  const isDineIn = receipt.orders.some(o => o.type === 'dine_in');
  const isPhone = receipt.orders.some(o => o.type === 'phone');
  const checkedOutAt = new Date(receipt.checkedOutAt);
  const paymentLabel = receipt.paymentMethod === 'cash' ? 'Cash' : receipt.paymentMethod === 'card' ? 'Card' : 'Mixed';
  const restaurantName = config.restaurant_name_en || config.restaurant_name_zh || '';
  const termsSegments = config.receipt_terms ? parseQRCodes(config.receipt_terms) : [];

  let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 15px; font-weight: bold; color: #000; max-width: 420px; margin: 0 auto; padding: 14px; }
    .center { text-align: center; }
    .divider { border-top: 2px dashed #000; margin: 10px 0; }
    .row { display: flex; justify-content: space-between; margin: 4px 0; }
    .big { font-size: 22px; margin: 6px 0; letter-spacing: 2px; }
    table { width: 100%; border-collapse: collapse; margin: 8px 0; }
    td { padding: 4px 0; vertical-align: top; }
    .qty { text-align: center; width: 36px; }
    .amt { text-align: right; }
    .sub { font-size: 13px; padding-left: 4px; }
    .terms { text-align: center; font-size: 13px; white-space: pre-line; margin-top: 10px; border-top: 2px dashed #000; padding-top: 10px; }
    .terms img { font-weight: normal; }
    .footer { text-align: center; margin-top: 14px; border-top: 2px dashed #000; padding-top: 10px; font-size: 13px; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      @page { margin: 0; size: 80mm auto; }
    }
  </style></head><body>`;

  // Header
  html += `<div class="center">`;
  if (restaurantName) html += `<div style="font-size:18px;margin-bottom:4px">${restaurantName}</div>`;
  if (config.restaurant_address) html += `<div style="font-size:13px">${config.restaurant_address}</div>`;
  if (config.restaurant_phone) html += `<div style="font-size:13px">Tel: ${config.restaurant_phone}</div>`;
  if (config.restaurant_website) html += `<div style="font-size:13px">${config.restaurant_website}</div>`;
  if (config.restaurant_email) html += `<div style="font-size:13px">${config.restaurant_email}</div>`;

  if (isDineIn) {
    if (receipt.tableNumber != null && receipt.tableNumber > 0) html += `<div class="big">Table ${receipt.tableNumber}</div>`;
    const seats = [...new Set(receipt.orders.map(o => o.seatNumber).filter(s => s != null && s > 0))].sort();
    if (seats.length > 0) html += `<div class="big">Seat ${seats.join(', ')}</div>`;
    const orderNum = receipt.orders.find(o => o.dineInOrderNumber)?.dineInOrderNumber;
    if (orderNum) html += `<div class="big">Order #${orderNum}</div>`;
    html += `<div style="font-size:12px;margin-top:4px">Ref: ${String(receipt.checkoutId).slice(-8).toUpperCase()}</div>`;
  } else if (isPhone) {
    html += `<div class="big">Phone #${receipt.orders[0]?.dailyOrderNumber || ''}</div>`;
  } else {
    html += `<div class="big">Pickup #${receipt.orders[0]?.dailyOrderNumber || ''}</div>`;
  }
  html += `</div><div class="divider"></div>`;

  // Items
  html += `<table>`;
  for (const order of receipt.orders) {
    for (const item of order.items) {
      html += `<tr><td><div>${item.itemName}</div>`;
      if (item.itemNameEn && item.itemNameEn !== item.itemName) html += `<div class="sub">${item.itemNameEn}</div>`;
      if (item.selectedOptions && item.selectedOptions.length > 0) {
        html += `<div class="sub">${item.selectedOptions.map(o => o.choiceName + (o.extraPrice > 0 ? ` +€${o.extraPrice}` : '')).join(', ')}</div>`;
      }
      html += `</td><td class="qty">x${item.quantity}</td><td class="amt">€${(item.unitPrice * item.quantity).toFixed(2)}</td></tr>`;
    }
  }
  html += `</table><div class="divider"></div>`;

  // Total
  const totalBundleDiscount = (bundleDiscounts || []).reduce((s, b) => s + b.discount, 0);
  if (totalBundleDiscount > 0) {
    const subtotal = receipt.totalAmount + totalBundleDiscount;
    html += `<div class="row"><span>Subtotal</span><span>€${subtotal.toFixed(2)}</span></div>`;
    for (const bd of bundleDiscounts || []) {
      html += `<div class="row"><span>🎁 ${bd.nameEn || bd.name}</span><span>-€${bd.discount.toFixed(2)}</span></div>`;
    }
    html += `<div class="row" style="font-size:18px;margin-top:4px"><span>Total</span><span>€${receipt.totalAmount.toFixed(2)}</span></div>`;
  } else {
    html += `<div class="row" style="font-size:18px"><span>Total</span><span>€${receipt.totalAmount.toFixed(2)}</span></div>`;
  }
  html += `<div class="row" style="margin-top:4px"><span>Payment</span><span>${paymentLabel}</span></div>`;

  if (receipt.paymentMethod === 'mixed') {
    html += `<div class="row"><span>Cash</span><span>€${(receipt.cashAmount ?? 0).toFixed(2)}</span></div>`;
    html += `<div class="row"><span>Card</span><span>€${(receipt.cardAmount ?? 0).toFixed(2)}</span></div>`;
  }

  if (receipt.paymentMethod === 'cash' && cashReceived != null && cashReceived > 0) {
    html += `<div class="divider"></div>`;
    html += `<div class="row"><span>Cash Received</span><span>€${cashReceived.toFixed(2)}</span></div>`;
    if (changeAmount != null && changeAmount > 0) {
      html += `<div class="row"><span>Change</span><span>€${changeAmount.toFixed(2)}</span></div>`;
    }
  }

  // Terms
  if (termsSegments.length > 0) {
    html += `<div class="terms">`;
    for (const seg of termsSegments) {
      if (seg.type === 'text') html += seg.value;
      else html += `<div style="margin:6px auto;font-weight:normal"><img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(seg.value)}" width="100" height="100" /></div>`;
    }
    html += `</div>`;
  }

  // Footer
  html += `<div class="footer"><div>${checkedOutAt.toLocaleString('en-GB')}</div><div style="margin-top:4px;font-size:12px">Thank you for dining with us!</div></div>`;
  html += `</body></html>`;
  return html;
}

/** Print HTML content via hidden iframe */
function printViaIframe(html: string, copies: number) {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.left = '-9999px';
  iframe.style.top = '-9999px';
  iframe.style.width = '0';
  iframe.style.height = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) { document.body.removeChild(iframe); return; }

  doc.open();
  doc.write(html);
  doc.close();

  // Wait for images to load, then print
  iframe.onload = () => {
    const images = doc.querySelectorAll('img');
    const promises = Array.from(images).map(img => {
      if (img.complete) return Promise.resolve();
      return new Promise<void>(r => { img.onload = () => r(); img.onerror = () => r(); });
    });
    Promise.all(promises).then(() => {
      setTimeout(() => {
        for (let i = 0; i < copies; i++) {
          iframe.contentWindow?.print();
        }
        // Clean up after a delay
        setTimeout(() => { document.body.removeChild(iframe); }, 1000);
      }, 100);
    });
  };
}

export default function ReceiptPrint({ checkoutId, cashReceived, changeAmount, bundleDiscounts, printCopies }: ReceiptPrintProps) {
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [config, setConfig] = useState<RestaurantConfig>({});
  const [copies, setCopies] = useState(2);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const autoPrintDone = useRef(false);
  const [configLoaded, setConfigLoaded] = useState(false);

  useEffect(() => {
    async function fetchData() {
      try {
        const [receiptRes, configRes] = await Promise.all([
          fetch(`/api/checkout/receipt/${checkoutId}`),
          fetch('/api/admin/config'),
        ]);
        if (!receiptRes.ok) throw new Error('Failed to fetch receipt');
        setReceipt(await receiptRes.json());
        if (configRes.ok) {
          const c: Record<string, string> = await configRes.json();
          setConfig(c);
          if (c.receipt_print_copies) setCopies(parseInt(c.receipt_print_copies, 10) || 2);
        }
        setConfigLoaded(true);
      } catch {
        setError('Error loading receipt');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [checkoutId]);

  // Auto-print once when BOTH receipt and config are ready
  useEffect(() => {
    if (receipt && configLoaded && !autoPrintDone.current) {
      autoPrintDone.current = true;
      const html = buildReceiptHTML(receipt, config, cashReceived, changeAmount, bundleDiscounts);
      printViaIframe(html, printCopies ?? copies);
    }
  }, [receipt, config, configLoaded, copies, printCopies, cashReceived, changeAmount, bundleDiscounts]);

  // Manual print function exposed via window.print override
  const handleManualPrint = useCallback(() => {
    if (!receipt) return;
    const html = buildReceiptHTML(receipt, config, cashReceived, changeAmount, bundleDiscounts);
    printViaIframe(html, 1);
  }, [receipt, config, cashReceived, changeAmount, bundleDiscounts]);

  // Expose manual print globally so parent buttons can use window.print()
  useEffect(() => {
    const origPrint = window.print.bind(window);
    window.print = () => {
      if (receipt) {
        handleManualPrint();
      } else {
        origPrint();
      }
    };
    return () => { window.print = origPrint; };
  }, [receipt, handleManualPrint]);

  if (loading) return <div>Loading...</div>;
  if (error) return <div style={{ color: 'red' }}>{error}</div>;
  if (!receipt) return null;

  // Render a visible preview (not used for printing)
  const isDineIn = receipt.orders.some(o => o.type === 'dine_in');
  const isPhonePreview = receipt.orders.some(o => o.type === 'phone');
  const checkedOutAt = new Date(receipt.checkedOutAt);
  const paymentLabel = receipt.paymentMethod === 'cash' ? 'Cash' : receipt.paymentMethod === 'card' ? 'Card' : 'Mixed';
  const restaurantName = config.restaurant_name_en || config.restaurant_name_zh || '';
  const termsSegments = config.receipt_terms ? parseQRCodes(config.receipt_terms) : [];

  return (
    <div style={{ fontFamily: 'Arial, Helvetica, sans-serif', maxWidth: 420, margin: '0 auto', padding: 16, fontSize: 14, fontWeight: 'bold', color: '#000', background: '#fff', border: '1px solid #ddd', borderRadius: 8 }}>
      <div style={{ textAlign: 'center', borderBottom: '2px dashed #000', paddingBottom: 8, marginBottom: 8 }}>
        {restaurantName && <div style={{ fontSize: 17, marginBottom: 4 }}>{restaurantName}</div>}
        {config.restaurant_address && <div style={{ fontSize: 13 }}>{config.restaurant_address}</div>}
        {config.restaurant_phone && <div style={{ fontSize: 13 }}>Tel: {config.restaurant_phone}</div>}
        <div style={{ marginTop: 6 }}>
          {isDineIn ? (
            <>
              {receipt.tableNumber != null && receipt.tableNumber > 0 && <div style={{ fontSize: 20 }}>Table {receipt.tableNumber}</div>}
              {(() => { const s = [...new Set(receipt.orders.map(o => o.seatNumber).filter(v => v != null && v > 0))].sort(); return s.length > 0 ? <div style={{ fontSize: 20 }}>Seat {s.join(', ')}</div> : null; })()}
              {(() => { const n = receipt.orders.find(o => o.dineInOrderNumber)?.dineInOrderNumber; return n ? <div style={{ fontSize: 20 }}>Order #{n}</div> : null; })()}
            </>
          ) : isPhonePreview ? (
            <div style={{ fontSize: 20 }}>Phone #{receipt.orders[0]?.dailyOrderNumber}</div>
          ) : (
            <div style={{ fontSize: 20 }}>Pickup #{receipt.orders[0]?.dailyOrderNumber}</div>
          )}
        </div>
      </div>

      {receipt.orders.flatMap(order => order.items.map(item => (
        <div key={item._id} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid #ddd' }}>
          <div style={{ flex: 1 }}>
            <div>{item.itemName}</div>
            {item.itemNameEn && item.itemNameEn !== item.itemName && <div style={{ fontSize: 12 }}>{item.itemNameEn}</div>}
            {item.selectedOptions && item.selectedOptions.length > 0 && <div style={{ fontSize: 12 }}>{item.selectedOptions.map(o => o.choiceName).join(', ')}</div>}
          </div>
          <div style={{ whiteSpace: 'nowrap' }}>x{item.quantity} €{(item.unitPrice * item.quantity).toFixed(2)}</div>
        </div>
      )))}

      <div style={{ borderTop: '2px dashed #000', margin: '8px 0' }} />
      {(() => {
        const totalBD = (bundleDiscounts || []).reduce((s, b) => s + b.discount, 0);
        if (totalBD > 0) {
          const subtotal = receipt.totalAmount + totalBD;
          return (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Subtotal</span><span>€{subtotal.toFixed(2)}</span></div>
              {(bundleDiscounts || []).map((bd, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>🎁 {bd.nameEn || bd.name}</span><span>-€{bd.discount.toFixed(2)}</span></div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 17, marginTop: 4 }}><span>Total</span><span>€{receipt.totalAmount.toFixed(2)}</span></div>
            </>
          );
        }
        return <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 17 }}><span>Total</span><span>€{receipt.totalAmount.toFixed(2)}</span></div>;
      })()}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}><span>Payment</span><span>{paymentLabel}</span></div>

      {receipt.paymentMethod === 'cash' && cashReceived != null && cashReceived > 0 && (
        <>
          <div style={{ borderTop: '2px dashed #000', margin: '8px 0' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Cash Received</span><span>€{cashReceived.toFixed(2)}</span></div>
          {changeAmount != null && changeAmount > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Change</span><span>€{changeAmount.toFixed(2)}</span></div>}
        </>
      )}

      {termsSegments.length > 0 && (
        <div style={{ textAlign: 'center', borderTop: '2px dashed #000', marginTop: 8, paddingTop: 8, fontSize: 12, whiteSpace: 'pre-line' }}>
          {termsSegments.map((seg, i) => seg.type === 'text' ? <span key={i}>{seg.value}</span> : (
            <div key={i} style={{ margin: '6px auto' }}><img src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(seg.value)}`} alt="QR" width={100} height={100} /></div>
          ))}
        </div>
      )}

      <div style={{ textAlign: 'center', borderTop: '2px dashed #000', marginTop: 8, paddingTop: 8, fontSize: 13 }}>
        {checkedOutAt.toLocaleString('en-GB')}
        <div style={{ fontSize: 12, marginTop: 2 }}>Thank you for dining with us!</div>
      </div>
    </div>
  );
}

export { printViaIframe, buildReceiptHTML };
