import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OfferData } from '../../utils/bundleMatcher';

interface MenuItem {
  _id: string;
  categoryId: string;
  price: number;
  translations: { locale: string; name: string }[];
  optionGroups?: unknown[];
  isSoldOut?: boolean;
}

interface Category {
  _id: string;
  translations: { locale: string; name: string }[];
}

interface Props {
  offer: OfferData;
  menuItems: MenuItem[];
  categories: Category[];
  lang: string;
  onConfirm: (selectedItems: { menuItemId: string; names: Record<string, string>; price: number }[]) => void;
  onClose: () => void;
}

export default function OfferSelectModal({ offer, menuItems, categories, lang, onConfirm, onClose }: Props) {
  const { t } = useTranslation();

  const getName = (translations: { locale: string; name: string }[]) => {
    const found = translations.find(t2 => t2.locale === lang) || translations[0];
    return found?.name || '';
  };

  const getNameMap = (translations: { locale: string; name: string }[]): Record<string, string> =>
    Object.fromEntries(translations.map(t2 => [t2.locale, t2.name]));

  const excluded = new Set(offer.excludedItemIds || []);

  // selections[slotIndex] = menuItemId
  const [selections, setSelections] = useState<Record<number, string>>(() => {
    const init: Record<number, string> = {};
    offer.slots.forEach((slot, idx) => {
      if (slot.type === 'item' && slot.itemId) {
        init[idx] = slot.itemId;
      }
    });
    return init;
  });

  const allSelected = offer.slots.every((_, idx) => selections[idx]);

  const handleConfirm = () => {
    const items = offer.slots.map((_, idx) => {
      const itemId = selections[idx];
      const mi = menuItems.find(m => m._id === itemId);
      return {
        menuItemId: itemId,
        names: mi ? getNameMap(mi.translations) : {},
        price: mi?.price || 0,
      };
    });
    onConfirm(items);
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: '16px 16px 0 0',
        width: '100%', maxWidth: 430, maxHeight: '80vh', display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-dark)' }}>
              🎁 {lang === 'zh-CN' ? offer.name : (offer.nameEn || offer.name)}
            </div>
            {(offer.description || offer.descriptionEn) && (
              <div style={{ fontSize: 12, color: 'var(--text-light)', marginTop: 2 }}>
                {lang === 'zh-CN' ? offer.description : (offer.descriptionEn || offer.description)}
              </div>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, color: 'var(--text-light)', cursor: 'pointer' }}>✕</button>
        </div>

        {/* Slots */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
          {offer.slots.map((slot, idx) => {
            const isItem = slot.type === 'item';
            const catName = !isItem && slot.categoryId
              ? getName(categories.find(c => c._id === slot.categoryId)?.translations || [])
              : '';

            if (isItem) {
              const mi = menuItems.find(m => m._id === slot.itemId);
              return (
                <div key={idx} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-light)', marginBottom: 4 }}>
                    {idx + 1}. {t('common.item', 'Item')}
                  </div>
                  <div style={{
                    padding: '12px 14px', borderRadius: 10,
                    background: '#E8F5E9', border: '2px solid #4CAF50',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>
                      ✓ {mi ? getName(mi.translations) : 'Unknown'}
                    </span>
                    <span style={{ fontSize: 13, color: 'var(--text-light)' }}>€{mi?.price || 0}</span>
                  </div>
                </div>
              );
            }

            // Category slot — dropdown
            const catItems = menuItems.filter(m =>
              m.categoryId === slot.categoryId && !excluded.has(m._id) && !m.isSoldOut
            );

            return (
              <div key={idx} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, color: 'var(--text-light)', marginBottom: 4 }}>
                  {idx + 1}. {catName || t('common.category', 'Category')}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
                  {catItems.map(mi => {
                    const selected = selections[idx] === mi._id;
                    return (
                      <div key={mi._id}
                        onClick={() => setSelections(prev => {
                          const next = { ...prev };
                          if (next[idx] === mi._id) delete next[idx];
                          else next[idx] = mi._id;
                          return next;
                        })}
                        style={{
                          padding: '10px 8px', borderRadius: 10, cursor: 'pointer',
                          textAlign: 'center', transition: 'all 0.12s',
                          border: selected ? '2px solid var(--red-primary)' : '1px solid #ddd',
                          background: selected ? 'var(--red-light, #FFF5F5)' : '#fafafa',
                        }}>
                        <div style={{ fontSize: 13, fontWeight: selected ? 700 : 500, lineHeight: 1.3, color: selected ? 'var(--red-primary)' : 'var(--text-dark)' }}>
                          {getName(mi.translations)}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 2 }}>€{mi.price}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px 20px', borderTop: '1px solid #eee' }}>
          <button onClick={handleConfirm} disabled={!allSelected}
            className="btn btn-primary"
            style={{
              width: '100%', padding: '14px 0', fontSize: 15, letterSpacing: 1,
              opacity: allSelected ? 1 : 0.5, cursor: allSelected ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
            {t('customer.confirmAdd', 'Add to Cart')}
            <span style={{ fontWeight: 700 }}>€{offer.bundlePrice.toFixed(2)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
