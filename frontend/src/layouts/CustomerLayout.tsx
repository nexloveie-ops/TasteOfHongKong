import { Outlet, useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useCart } from '../context/CartContext';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { matchBundles, calcBundleTotal, type OfferData } from '../utils/bundleMatcher';
import { useRestaurantConfig } from '../hooks/useRestaurantConfig';
import { apiFetch } from '../api/client';
import { useStoreSlug } from '../context/StoreContext';

const AD_CONTACT_EMAIL = 'info@lztechserve.com';

export default function CustomerLayout() {
  const { t } = useTranslation();
  const storeSlug = useStoreSlug();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { totalItems, totalAmount, items: cartItems, getItemKey } = useCart();
  const { displayName, config } = useRestaurantConfig();
  const logoUrl = config.restaurant_logo?.trim();
  const table = searchParams.get('table');
  const seat = searchParams.get('seat');
  const qs = searchParams.toString();

  const isCartPage = location.pathname.includes('/cart');

  const [offers, setOffers] = useState<OfferData[]>([]);
  const [menuItemCats, setMenuItemCats] = useState<Record<string, string>>({});

  useEffect(() => {
    apiFetch('/api/offers')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: unknown) => setOffers(Array.isArray(data) ? data : []))
      .catch(() => {});
    apiFetch('/api/menu/items?ownOptionGroups=1')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: unknown) => {
        const list = Array.isArray(data) ? data : [];
        const map: Record<string, string> = {};
        for (const item of list as { _id: string; categoryId: string }[]) map[item._id] = item.categoryId;
        setMenuItemCats(map);
      })
      .catch(() => {});
  }, []);

  const finalTotal = useMemo(() => {
    if (offers.length === 0 || cartItems.length === 0) return totalAmount;
    const entries = cartItems.map(ci => ({
      key: getItemKey(ci),
      menuItemId: ci.menuItemId,
      categoryId: menuItemCats[ci.menuItemId] || '',
      basePrice: ci.price,
      optionExtra: (ci.options || []).reduce((s, o) => s + o.extraPrice, 0),
      quantity: ci.quantity,
    }));
    const matched = matchBundles(entries, offers);
    return calcBundleTotal(entries, matched).finalTotal;
  }, [cartItems, offers, menuItemCats, totalAmount, getItemKey]);

  const hasDiscount = finalTotal < totalAmount;

  const goToCart = () => {
    navigate(`cart${qs ? '?' + qs : ''}`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', maxWidth: 430, margin: '0 auto', width: '100%', background: 'var(--bg-cream)' }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '10px 16px', background: 'var(--bg-white)',
        borderBottom: '1px solid var(--border-light)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {logoUrl ? (
            <img src={logoUrl} alt="" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
          ) : null}
          <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 16, color: 'var(--red-primary)' }}>
            {displayName || storeSlug}
          </span>
          {table && seat && (
            <span style={{ fontSize: 12, color: 'var(--text-light)' }}>
              🪑 Table {table} · Seat {seat}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <LanguageSwitcher />
          {!isCartPage && totalItems > 0 && (
            <div onClick={goToCart} style={{
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
              background: 'var(--red-primary)', color: '#fff',
              borderRadius: 20, padding: '5px 12px 5px 8px',
            }}>
              <div style={{ position: 'relative', fontSize: 18 }}>
                🛒
                <span style={{
                  position: 'absolute', top: -6, right: -8,
                  background: '#F9A825', color: '#000',
                  fontSize: 9, fontWeight: 700, width: 16, height: 16,
                  borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{totalItems}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 4 }}>
                {hasDiscount && (
                  <span style={{ fontSize: 10, textDecoration: 'line-through', opacity: 0.6 }}>€{totalAmount.toFixed(2)}</span>
                )}
                <span style={{ fontSize: 14, fontWeight: 700 }}>€{finalTotal.toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <Outlet />
      </div>

      <footer style={{
        flexShrink: 0,
        padding: '6px 10px calc(6px + env(safe-area-inset-bottom, 0px))',
        textAlign: 'center',
        fontSize: 10,
        color: 'var(--text-light)',
        lineHeight: 1.3,
        borderTop: '1px solid var(--border-light)',
        background: 'var(--bg-white)',
      }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: '4px 6px' }}>
          <span style={{ opacity: 0.92, fontWeight: 600 }}>{t('customer.footerCompany')}</span>
          <span style={{ opacity: 0.35, userSelect: 'none' }} aria-hidden>·</span>
          <span style={{ opacity: 0.92 }}>{t('customer.footerAdContact')}</span>
          <a href={`mailto:${AD_CONTACT_EMAIL}`} style={{ color: 'var(--text-light)', textDecoration: 'none', fontSize: 10 }}>
            {AD_CONTACT_EMAIL}
          </a>
        </div>
      </footer>
    </div>
  );
}
