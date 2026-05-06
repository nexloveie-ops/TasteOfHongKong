import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCart } from '../../context/CartContext';
import { matchBundles, calcBundleTotal, type OfferData, type MatchedBundle } from '../../utils/bundleMatcher';
import { apiFetch } from '../../api/client';
import { useRestaurantConfig } from '../../hooks/useRestaurantConfig';

export default function CartPage() {
  const { items, increaseQuantity, decreaseQuantity, removeItem, clearCart, totalAmount, totalItems, getItemKey, editOrderId, setEditOrderId } = useCart();
  const navigate = useNavigate();
  const { storeSlug } = useParams<{ storeSlug: string }>();
  const [searchParams] = useSearchParams();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { config } = useRestaurantConfig();
  const storePhone = (config.restaurant_phone || '').trim();
  const getItemName = (names: Record<string, string>) => names[lang] || Object.values(names)[0] || '';
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [offers, setOffers] = useState<OfferData[]>([]);
  const [menuItemCategories, setMenuItemCategories] = useState<Record<string, string>>({});
  const [offersLoaded, setOffersLoaded] = useState(false);
  const [deliveryCustomerName, setDeliveryCustomerName] = useState('');
  const [deliveryCustomerPhone, setDeliveryCustomerPhone] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryPostalCode, setDeliveryPostalCode] = useState('');

  const table = searchParams.get('table');
  const seat = searchParams.get('seat');
  const orderType = searchParams.get('type');
  const qs = searchParams.toString();

  // Fetch offers and menu item category mapping
  useEffect(() => {
    let loaded = 0;
    const check = () => { loaded++; if (loaded >= 2) setOffersLoaded(true); };
    apiFetch('/api/offers').then(r => r.ok ? r.json() : []).then(d => { setOffers(d); check(); }).catch(() => check());
    apiFetch('/api/menu/items?ownOptionGroups=1').then(r => r.ok ? r.json() : []).then((data: { _id: string; categoryId: string }[]) => {
      const map: Record<string, string> = {};
      for (const item of data) map[item._id] = item.categoryId;
      setMenuItemCategories(map);
      check();
    }).catch(() => check());
  }, []);

  // Bundle matching
  const matchedBundles: MatchedBundle[] = useMemo(() => {
    if (offers.length === 0 || items.length === 0) return [];
    const cartEntries = items.map(item => {
      const optExtra = (item.options || []).reduce((s, o) => s + o.extraPrice, 0);
      return {
        key: getItemKey(item),
        menuItemId: item.menuItemId,
        categoryId: menuItemCategories[item.menuItemId] || '',
        basePrice: item.price,
        optionExtra: optExtra,
        quantity: item.quantity,
      };
    });
    return matchBundles(cartEntries, offers);
  }, [items, offers, menuItemCategories, getItemKey]);

  const bundleTotals = useMemo(() => {
    const cartEntries = items.map(item => {
      const optExtra = (item.options || []).reduce((s, o) => s + o.extraPrice, 0);
      return {
        key: getItemKey(item),
        menuItemId: item.menuItemId,
        categoryId: menuItemCategories[item.menuItemId] || '',
        basePrice: item.price,
        optionExtra: optExtra,
        quantity: item.quantity,
      };
    });
    return calcBundleTotal(cartEntries, matchedBundles);
  }, [items, matchedBundles, menuItemCategories, getItemKey]);

  const finalTotal = bundleTotals.finalTotal;

  const handleSubmit = async () => {
    if (items.length === 0) return;
    setSubmitting(true);
    setError('');
    try {
      const itemsPayload = items.map(i => {
        const item: Record<string, unknown> = { menuItemId: i.menuItemId, quantity: i.quantity };
        if (i.options && i.options.length > 0) {
          item.selectedOptions = i.options.map(o => ({ groupId: o.groupId, choiceId: o.choiceId }));
        }
        return item;
      });

      let res: Response;
      if (editOrderId) {
        // Update existing order
        res = await apiFetch(`/api/orders/${editOrderId}/items`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: itemsPayload }),
        });
      } else {
        // Create new order
        const body: Record<string, unknown> = { items: itemsPayload };
        if (orderType === 'takeout') {
          body.type = 'takeout';
        } else if (orderType === 'delivery') {
          if (!deliveryCustomerName.trim() || !deliveryCustomerPhone.trim() || !deliveryAddress.trim() || !deliveryPostalCode.trim()) {
            setError('请填写送餐姓名、电话、地址与邮编');
            return;
          }
          body.type = 'delivery';
          body.deliverySource = 'qr';
          body.customerName = deliveryCustomerName.trim();
          body.customerPhone = deliveryCustomerPhone.trim();
          body.deliveryAddress = deliveryAddress.trim();
          body.postalCode = deliveryPostalCode.trim();
        } else {
          body.type = 'dine_in';
          body.tableNumber = Number(table);
          body.seatNumber = Number(seat);
        }
        // Include bundle discount info
        if (matchedBundles.length > 0) {
          body.appliedBundles = matchedBundles.map(b => ({
            offerId: b.offer._id,
            name: b.offer.name,
            nameEn: b.offer.nameEn,
            discount: b.savings,
          }));
        }
        res = await apiFetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setError(j?.error?.message || t('customer.updateFailed'));
        return;
      }
      const order = await res.json();
      const rawId = editOrderId ?? order._id;
      const navId = typeof rawId === 'string' ? rawId : String(rawId);
      clearCart();
      setEditOrderId(null);
      if (!storeSlug) {
        setError(t('customer.updateFailed'));
        return;
      }
      const search = qs ? `?${qs}` : '';
      navigate(`/${storeSlug}/customer/order/${navId}${search}`);
    } catch {
      setError(t('customer.updateFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  if (items.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 16 }}>
        <span style={{ fontSize: 48, opacity: 0.3 }}>🛒</span>
        <p style={{ color: 'var(--text-light)' }}>{t('customer.emptyCart')}</p>
        <button className="btn btn-primary" onClick={() => navigate(`/${storeSlug}/customer/menu${qs ? `?${qs}` : ''}`)}>
          {t('customer.backToMenu')}
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: 16, paddingBottom: 120 }}>
      <h2 style={{ fontFamily: "'Noto Serif SC', serif", fontSize: 20, marginBottom: 16, color: 'var(--text-dark)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => navigate(`/${storeSlug}/customer/menu${qs ? `?${qs}` : ''}`)} style={{
          background: 'none', border: 'none', cursor: 'pointer', fontSize: 18,
          color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', padding: 0,
        }}>←</button>
        {t('customer.cart')}
      </h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map(item => {
          const key = getItemKey(item);
          const optExtra = (item.options || []).reduce((s, o) => s + o.extraPrice, 0);
          return (
            <div key={key} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              background: 'var(--bg-white)', borderRadius: 10, padding: '12px 14px',
              border: '1px solid rgba(232,213,184,0.5)',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-dark)' }}>{getItemName(item.names)}</div>
                {item.options && item.options.length > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 2 }}>
                    {item.options.map((o, i) => (
                      <span key={i}>
                        {i > 0 && ' · '}
                        {o.groupName[lang] || Object.values(o.groupName)[0]}: {o.choiceName[lang] || Object.values(o.choiceName)[0]}
                        {o.extraPrice > 0 && ` +€${o.extraPrice}`}
                      </span>
                    ))}
                  </div>
                )}
                <div style={{ fontSize: 13, color: 'var(--red-primary)', fontWeight: 600, fontFamily: "'Noto Serif SC', serif" }}>
                  €{item.price}{optExtra > 0 && ` +€${optExtra}`}
                </div>
              </div>
              <div style={{
                display: 'flex', alignItems: 'center', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden',
              }}>
                <button onClick={() => decreaseQuantity(key)} style={{
                  width: 34, height: 34, background: 'var(--bg)', fontSize: 16, fontWeight: 700,
                  color: 'var(--red-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>−</button>
                <span style={{ width: 34, textAlign: 'center', fontSize: 14, fontWeight: 700 }}>{item.quantity}</span>
                <button onClick={() => increaseQuantity(key)} style={{
                  width: 34, height: 34, background: 'var(--bg)', fontSize: 16, fontWeight: 700,
                  color: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>+</button>
              </div>
              <div style={{ fontWeight: 700, color: 'var(--red-primary)', minWidth: 50, textAlign: 'right', fontFamily: "'Noto Serif SC', serif" }}>
                €{((item.price + optExtra) * item.quantity).toFixed(2)}
              </div>
              <button onClick={() => removeItem(key)} style={{
                background: 'none', color: 'var(--text-light)', fontSize: 18, padding: 4,
              }}>✕</button>
            </div>
          );
        })}
      </div>

      {error && <div style={{ color: 'var(--red-primary)', marginTop: 12, fontSize: 13 }}>{error}</div>}
      {orderType === 'delivery' && (
        <div style={{
          marginTop: 12,
          padding: '12px 14px',
          borderRadius: 10,
          border: '1px solid #E65100',
          background: '#FFF8E1',
          fontSize: 13,
          lineHeight: 1.55,
          color: '#5D4037',
        }}>
          <div style={{ fontWeight: 700, marginBottom: 8, color: '#E65100' }}>{t('customer.deliveryPolicyTitle')}</div>
          <p style={{ margin: '0 0 8px' }}>{t('customer.deliveryPolicyUnpaidNoKitchen')}</p>
          <p style={{ margin: '0 0 6px' }}>{t('customer.deliveryPolicyCashCallUs')}</p>
          {storePhone ? (
            <a href={`tel:${storePhone.replace(/\s/g, '')}`} style={{ fontWeight: 700, color: '#BF360C', wordBreak: 'break-all' }}>
              {t('customer.deliveryStorePhoneLabel')}：{storePhone}
            </a>
          ) : (
            <span style={{ fontSize: 12, color: '#6D4C41' }}>{t('customer.deliveryNoPhoneConfigured')}</span>
          )}
        </div>
      )}
      {orderType === 'delivery' && (
        <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
          <input className="input" placeholder="收货姓名" value={deliveryCustomerName} onChange={e => setDeliveryCustomerName(e.target.value)} />
          <input className="input" placeholder="联系电话" value={deliveryCustomerPhone} onChange={e => setDeliveryCustomerPhone(e.target.value)} />
          <input className="input" placeholder="送餐地址" value={deliveryAddress} onChange={e => setDeliveryAddress(e.target.value)} />
          <input className="input" placeholder="邮编" value={deliveryPostalCode} onChange={e => setDeliveryPostalCode(e.target.value)} />
        </div>
      )}

      {/* Bundle discount display */}
      {matchedBundles.length > 0 && (
        <div style={{ marginTop: 12, padding: '10px 14px', background: '#E8F5E9', borderRadius: 10, border: '1px solid #C8E6C9' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#2E7D32', marginBottom: 4 }}>🎁 {lang === 'zh-CN' ? '套餐优惠已匹配' : 'Bundle Offer Applied'}</div>
          {matchedBundles.map((b, i) => (
            <div key={i} style={{ fontSize: 12, color: '#388E3C', display: 'flex', justifyContent: 'space-between' }}>
              <span>{b.offer.name}{b.offer.nameEn ? ` ${b.offer.nameEn}` : ''}</span>
              <span style={{ fontWeight: 600 }}>-€{b.savings.toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Fixed bottom bar */}
      <div style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        maxWidth: 430, width: '100%', padding: '16px 20px',
        background: 'var(--bg-white)', borderTop: '2px solid var(--border-light)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 100,
      }}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-light)' }}>{t('customer.totalAmount')} · {totalItems} {t('customer.quantity')}</div>
          {bundleTotals.bundleDiscount > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-light)', textDecoration: 'line-through' }}>€{totalAmount.toFixed(2)}</div>
          )}
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--red-primary)', fontFamily: "'Noto Serif SC', serif" }}>€{finalTotal.toFixed(2)}</div>
        </div>
        <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting || !offersLoaded}
          style={{ padding: '12px 28px', fontSize: 15, letterSpacing: 1 }}>
          {!offersLoaded ? '...' : submitting ? t('common.loading') : editOrderId ? t('customer.saveChanges') : t('customer.submitOrder')}
        </button>
      </div>
    </div>
  );
}
