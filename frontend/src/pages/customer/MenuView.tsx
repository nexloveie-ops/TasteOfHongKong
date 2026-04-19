import { useEffect, useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useCart } from '../../context/CartContext';
import MenuItemCard from '../../components/customer/MenuItemCard';
import type { OfferData } from '../../utils/bundleMatcher';

interface Category { _id: string; sortOrder: number; translations: { locale: string; name: string }[]; }
interface AllergenData { _id: string; icon: string; }
interface MenuItemData {
  _id: string; categoryId: string; price: number; calories?: number;
  avgWaitMinutes?: number; photoUrl?: string; arFileUrl?: string; isSoldOut?: boolean;
  translations: { locale: string; name: string; description?: string }[];
  allergenIds?: string[];
  optionGroups?: {
    _id: string; required: boolean;
    translations: { locale: string; name: string }[];
    choices: { _id: string; extraPrice: number; translations: { locale: string; name: string }[] }[];
  }[];
}

export default function MenuView() {
  const { i18n } = useTranslation();
  const { addItem, items: cartItems, decreaseQuantity, getItemKey } = useCart();
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItemData[]>([]);
  const [allergens, setAllergens] = useState<AllergenData[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>('');
  const lang = i18n.language;

  // Active offers for banner
  const [activeOffers, setActiveOffers] = useState<OfferData[]>([]);

  // Refs for scroll-based category tracking
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const tabsRef = useRef<HTMLDivElement>(null);
  const isUserClick = useRef(false);

  useEffect(() => {
    fetch(`/api/menu/categories?lang=${lang}`).then(r => r.json()).then((data: Category[]) => {
      setCategories(data);
      if (data.length > 0 && !activeCategory) setActiveCategory(data[0]._id);
    }).catch(() => {});
  }, [lang]);

  useEffect(() => {
    fetch(`/api/menu/items?lang=${lang}`).then(r => r.json()).then(setItems).catch(() => {});
    fetch('/api/allergens').then(r => r.json()).then(setAllergens).catch(() => {});
    fetch('/api/offers').then(r => r.ok ? r.json() : []).then(setActiveOffers).catch(() => {});
  }, [lang]);

  const getName = (translations: { locale: string; name: string }[]) => {
    const found = translations.find(t2 => t2.locale === lang) || translations[0];
    return found?.name || '';
  };
  const getDesc = (translations: { locale: string; description?: string }[]) => {
    const found = translations.find(t2 => t2.locale === lang) || translations[0];
    return found?.description || '';
  };

  // IntersectionObserver: track which section is in view
  useEffect(() => {
    if (categories.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (isUserClick.current) return; // skip during programmatic scroll
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const catId = entry.target.getAttribute('data-cat-id');
            if (catId) {
              setActiveCategory(catId);
              // Auto-scroll the tab into view
              const tabEl = document.getElementById(`tab-${catId}`);
              tabEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            }
            break;
          }
        }
      },
      {
        root: scrollContainerRef.current,
        rootMargin: '-20% 0px -60% 0px',
        threshold: 0,
      }
    );

    sectionRefs.current.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [categories, items]);

  // Click tab → scroll to section
  const handleTabClick = useCallback((catId: string) => {
    setActiveCategory(catId);
    const sectionEl = sectionRefs.current.get(catId);
    if (sectionEl && scrollContainerRef.current) {
      isUserClick.current = true;
      sectionEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => { isUserClick.current = false; }, 800);
    }
  }, []);

  const [heroHidden, setHeroHidden] = useState(false);
  const lastScrollY = useRef(0);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const y = el.scrollTop;
    if (y > 30 && y > lastScrollY.current) {
      setHeroHidden(true);
    } else if (y < lastScrollY.current - 5 || y <= 10) {
      setHeroHidden(false);
    }
    lastScrollY.current = y;
  }, []);

  // Get cart quantity for a menu item
  const getCartQty = (menuItemId: string) => cartItems.filter(ci => ci.menuItemId === menuItemId).reduce((s, ci) => s + ci.quantity, 0);

  const handleDecrease = (menuItemId: string) => {
    // Find the last cart item matching this menuItemId and decrease it
    const matching = cartItems.filter(ci => ci.menuItemId === menuItemId);
    if (matching.length > 0) {
      const last = matching[matching.length - 1];
      decreaseQuantity(getItemKey(last));
    }
  };

  // Group items by category
  const itemsByCategory = new Map<string, MenuItemData[]>();
  for (const item of items) {
    if (!itemsByCategory.has(item.categoryId)) itemsByCategory.set(item.categoryId, []);
    itemsByCategory.get(item.categoryId)!.push(item);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Hero — hides on scroll down, shows on scroll up */}
      <div style={{
        position: 'relative', height: heroHidden ? 0 : (activeOffers.length > 0 ? 'auto' : 140), minHeight: heroHidden ? 0 : 140, flexShrink: 0,
        background: 'linear-gradient(135deg, #8B1A1A 0%, #C41E24 50%, #D4342A 100%)',
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: heroHidden ? 0 : 20, overflow: 'hidden',
        transition: 'min-height 0.3s ease, padding 0.3s ease',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div style={{ position: 'relative', zIndex: 1, color: '#fff' }}>
            <h1 style={{ fontFamily: "'Noto Serif SC', serif", fontSize: 24, fontWeight: 700, letterSpacing: 3, marginBottom: 2 }}>港知味</h1>
            <div style={{ fontSize: 11, fontWeight: 300, letterSpacing: 5, color: '#F0D68A' }}>TASTE OF HONG KONG</div>
          </div>
          <div style={{ position: 'absolute', top: 8, right: 12, zIndex: 1, textAlign: 'right', color: 'rgba(255,255,255,0.7)', fontSize: 9, lineHeight: 1.5 }}>
            <div>Powered By <span style={{ fontWeight: 600, color: '#F0D68A' }}>L&amp;Z TECHSERVE LTD</span></div>
            <div>info@lztechserve.com</div>
          </div>
        </div>
        {/* Active offers */}
        {activeOffers.length > 0 && !heroHidden && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {activeOffers.map(offer => (
              <div key={offer._id} style={{
                background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(4px)',
                borderRadius: 10, padding: '10px 14px',
                border: '1px solid rgba(240,214,138,0.3)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ color: '#F0D68A', fontSize: 13, fontWeight: 700 }}>
                      🎁 {lang === 'zh-CN' ? offer.name : (offer.nameEn || offer.name)}
                    </div>
                    {(offer.description || offer.descriptionEn) && (
                      <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 11, marginTop: 2 }}>
                        {lang === 'zh-CN' ? offer.description : (offer.descriptionEn || offer.description)}
                      </div>
                    )}
                  </div>
                  <div style={{ color: '#fff', fontSize: 18, fontWeight: 700, fontFamily: "'Noto Serif SC', serif", flexShrink: 0, marginLeft: 12 }}>
                    €{offer.bundlePrice.toFixed(2)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sticky Category Tabs */}
      <div ref={tabsRef} style={{
        display: 'flex', gap: 0, padding: '0 16px', background: 'var(--bg-white, #fff)',
        borderBottom: '2px solid var(--border-light, #E8D5B8)', overflowX: 'auto', flexShrink: 0,
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        {categories.map(cat => (
          <button
            key={cat._id}
            id={`tab-${cat._id}`}
            onClick={() => handleTabClick(cat._id)}
            style={{
              flexShrink: 0, padding: '14px 18px', fontSize: 14,
              fontWeight: activeCategory === cat._id ? 600 : 500,
              color: activeCategory === cat._id ? 'var(--red-primary, #C41E24)' : 'var(--text-light, #999)',
              border: 'none', background: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
              borderBottom: activeCategory === cat._id ? '3px solid var(--red-primary, #C41E24)' : '3px solid transparent',
              transition: 'color 0.2s, border-color 0.2s',
            }}
          >
            {getName(cat.translations)}
          </button>
        ))}
      </div>

      {/* Scrollable Content — all categories rendered continuously */}
      <div ref={scrollContainerRef} onScroll={handleScroll} style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
        {categories.map(cat => {
          const catItems = itemsByCategory.get(cat._id) || [];
          return (
            <div
              key={cat._id}
              data-cat-id={cat._id}
              ref={(el) => { if (el) sectionRefs.current.set(cat._id, el); }}
            >
              {/* Section Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '20px 20px 12px' }}>
                <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg, transparent, #D4A853, transparent)' }} />
                <h2 style={{
                  fontFamily: "'Noto Serif SC', serif", fontSize: 18, fontWeight: 600,
                  color: 'var(--text-dark, #2C1810)', letterSpacing: 4, whiteSpace: 'nowrap',
                }}>
                  {getName(cat.translations)}
                </h2>
                <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg, transparent, #D4A853, transparent)' }} />
              </div>

              {/* Items */}
              <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {catItems.length > 0 ? catItems.map(item => (
                  <MenuItemCard
                    key={item._id}
                    id={item._id}
                    name={getName(item.translations)}
                    names={Object.fromEntries(item.translations.map(t2 => [t2.locale, t2.name]))}
                    description={getDesc(item.translations)}
                    price={item.price}
                    calories={item.calories}
                    avgWaitMinutes={item.avgWaitMinutes}
                    photoUrl={item.photoUrl}
                    arFileUrl={item.arFileUrl}
                    isSoldOut={item.isSoldOut}
                    allergenIcons={(item.allergenIds || []).map(aid => allergens.find(a => a._id === aid)?.icon).filter((x): x is string => !!x)}
                    optionGroups={item.optionGroups}
                    quantity={getCartQty(item._id)}
                    onAdd={addItem}
                    onDecrease={handleDecrease}
                  />
                )) : (
                  <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-light, #999)', fontSize: 13 }}>
                    暂无菜品
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Footer */}
        <div style={{ height: 20 }} />
      </div>

    </div>
  );
}
