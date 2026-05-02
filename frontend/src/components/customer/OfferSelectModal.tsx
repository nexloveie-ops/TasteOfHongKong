import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { CartItemOption } from '../../context/CartContext';
import type { OfferData } from '../../utils/bundleMatcher';

interface OptionChoice {
  _id: string;
  extraPrice: number;
  originalPrice?: number;
  translations: { locale: string; name: string }[];
}

interface OptionGroup {
  _id: string;
  required: boolean;
  translations: { locale: string; name: string }[];
  choices: OptionChoice[];
}

interface MenuItem {
  _id: string;
  categoryId: string;
  price: number;
  translations: { locale: string; name: string }[];
  optionGroups?: OptionGroup[];
  isSoldOut?: boolean;
}

interface Category {
  _id: string;
  translations: { locale: string; name: string }[];
}

interface SelectedItemWithOptions {
  menuItemId: string;
  names: Record<string, string>;
  price: number;
  options?: CartItemOption[];
}

interface Props {
  offer: OfferData;
  menuItems: MenuItem[];
  categories: Category[];
  lang: string;
  onConfirm: (selectedItems: SelectedItemWithOptions[]) => void;
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

  // optionSelections[slotIndex][groupId] = choiceId (single) or choiceId[] (multi)
  const [singleOpts, setSingleOpts] = useState<Record<string, Record<string, string>>>({});
  const [multiOpts, setMultiOpts] = useState<Record<string, Record<string, string[]>>>({});

  // When item selection changes, reset its options
  const selectItem = (idx: number, itemId: string) => {
    setSelections(prev => {
      const next = { ...prev };
      if (next[idx] === itemId) delete next[idx];
      else next[idx] = itemId;
      return next;
    });
    const key = String(idx);
    setSingleOpts(prev => { const n = { ...prev }; delete n[key]; return n; });
    setMultiOpts(prev => { const n = { ...prev }; delete n[key]; return n; });
  };

  const toggleSingle = (slotKey: string, groupId: string, choiceId: string) => {
    setSingleOpts(prev => {
      const slot = { ...(prev[slotKey] || {}) };
      if (slot[groupId] === choiceId) delete slot[groupId];
      else slot[groupId] = choiceId;
      return { ...prev, [slotKey]: slot };
    });
  };

  const toggleMulti = (slotKey: string, groupId: string, choiceId: string) => {
    setMultiOpts(prev => {
      const slot = { ...(prev[slotKey] || {}) };
      const current = slot[groupId] || [];
      slot[groupId] = current.includes(choiceId)
        ? current.filter(id => id !== choiceId)
        : [...current, choiceId];
      return { ...prev, [slotKey]: slot };
    });
  };

  // Check if all required options are selected for each slot
  const allOptionsValid = useMemo(() => {
    return offer.slots.every((_, idx) => {
      const itemId = selections[idx];
      if (!itemId) return false;
      const mi = menuItems.find(m => m._id === itemId);
      if (!mi?.optionGroups) return true;
      const key = String(idx);
      return mi.optionGroups.every(g => {
        if (!g.required) return true;
        return !!(singleOpts[key]?.[g._id]);
      });
    });
  }, [selections, singleOpts, offer.slots, menuItems]);

  const allSelected = offer.slots.every((_, idx) => selections[idx]);

  // Calculate total option extras for all slots
  const totalOptionExtra = useMemo(() => {
    let sum = 0;
    offer.slots.forEach((_, idx) => {
      const itemId = selections[idx];
      if (!itemId) return;
      const mi = menuItems.find(m => m._id === itemId);
      if (!mi?.optionGroups) return;
      const key = String(idx);
      for (const g of mi.optionGroups) {
        if (g.required) {
          const cId = singleOpts[key]?.[g._id];
          if (cId) { const c = g.choices.find(x => x._id === cId); sum += c?.extraPrice || 0; }
        } else {
          for (const cId of (multiOpts[key]?.[g._id] || [])) {
            const c = g.choices.find(x => x._id === cId); sum += c?.extraPrice || 0;
          }
        }
      }
    });
    return sum;
  }, [selections, singleOpts, multiOpts, offer.slots, menuItems]);

  const handleConfirm = () => {
    const items: SelectedItemWithOptions[] = offer.slots.map((_, idx) => {
      const itemId = selections[idx];
      const mi = menuItems.find(m => m._id === itemId);
      const key = String(idx);
      const options: CartItemOption[] = [];

      if (mi?.optionGroups) {
        for (const g of mi.optionGroups) {
          if (g.required) {
            const cId = singleOpts[key]?.[g._id];
            if (cId) {
              const c = g.choices.find(x => x._id === cId);
              if (c) options.push({
                groupId: g._id, choiceId: c._id,
                groupName: getNameMap(g.translations), choiceName: getNameMap(c.translations),
                extraPrice: c.extraPrice || 0,
              });
            }
          } else {
            for (const cId of (multiOpts[key]?.[g._id] || [])) {
              const c = g.choices.find(x => x._id === cId);
              if (c) options.push({
                groupId: g._id, choiceId: c._id,
                groupName: getNameMap(g.translations), choiceName: getNameMap(c.translations),
                extraPrice: c.extraPrice || 0,
              });
            }
          }
        }
      }

      return {
        menuItemId: itemId,
        names: mi ? getNameMap(mi.translations) : {},
        price: mi?.price || 0,
        options: options.length > 0 ? options : undefined,
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
        width: '100%', maxWidth: 430, maxHeight: '85vh', display: 'flex', flexDirection: 'column',
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
            const key = String(idx);
            const selectedItemId = selections[idx];
            const selectedMi = selectedItemId ? menuItems.find(m => m._id === selectedItemId) : null;

            return (
              <div key={idx} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: 'var(--text-light)', marginBottom: 6 }}>
                  {idx + 1}. {isItem ? t('common.item', 'Item') : (catName || t('common.category', 'Category'))}
                </div>

                {isItem ? (
                  // Fixed item slot
                  <div style={{
                    padding: '12px 14px', borderRadius: 10,
                    background: '#E8F5E9', border: '2px solid #4CAF50',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>
                      ✓ {selectedMi ? getName(selectedMi.translations) : 'Unknown'}
                    </span>
                    <span style={{ fontSize: 13, color: 'var(--text-light)' }}>€{selectedMi?.price || 0}</span>
                  </div>
                ) : (
                  // Category slot — grid of choices
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8 }}>
                    {menuItems.filter(m => m.categoryId === slot.categoryId && !excluded.has(m._id) && !m.isSoldOut).map(mi => {
                      const selected = selections[idx] === mi._id;
                      return (
                        <div key={mi._id} onClick={() => selectItem(idx, mi._id)} style={{
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
                )}

                {/* Option groups for selected item */}
                {selectedMi?.optionGroups && selectedMi.optionGroups.length > 0 && (
                  <div style={{ marginTop: 10, paddingLeft: 4 }}>
                    {selectedMi.optionGroups.map(group => (
                      <div key={group._id} style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                          {getName(group.translations)}
                          {group.required
                            ? <span style={{ fontSize: 10, color: '#fff', background: 'var(--red-primary)', padding: '1px 5px', borderRadius: 4 }}>{t('admin.required')}</span>
                            : <span style={{ fontSize: 10, color: 'var(--text-light)', padding: '1px 5px', borderRadius: 4, border: '1px solid var(--border)' }}>多选</span>
                          }
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 6 }}>
                          {group.choices.map(choice => {
                            const selected = group.required
                              ? singleOpts[key]?.[group._id] === choice._id
                              : (multiOpts[key]?.[group._id] || []).includes(choice._id);
                            return (
                              <div key={choice._id}
                                onClick={() => group.required
                                  ? toggleSingle(key, group._id, choice._id)
                                  : toggleMulti(key, group._id, choice._id)
                                }
                                style={{
                                  padding: '8px 6px', borderRadius: 8, cursor: 'pointer',
                                  textAlign: 'center', transition: 'all 0.12s',
                                  border: selected ? '2px solid var(--red-primary)' : '1px solid #ddd',
                                  background: selected ? 'var(--red-light, #FFF5F5)' : '#fafafa',
                                }}>
                                <div style={{ fontSize: 12, fontWeight: selected ? 700 : 500, color: selected ? 'var(--red-primary)' : 'var(--text-dark)' }}>
                                  {getName(choice.translations)}
                                </div>
                                {choice.extraPrice > 0 && (
                                  <div style={{ fontSize: 10, color: 'var(--red-primary)', marginTop: 1 }}>+€{choice.extraPrice}</div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px 20px', borderTop: '1px solid #eee' }}>
          <button onClick={handleConfirm} disabled={!allSelected || !allOptionsValid}
            className="btn btn-primary"
            style={{
              width: '100%', padding: '14px 0', fontSize: 15, letterSpacing: 1,
              opacity: (allSelected && allOptionsValid) ? 1 : 0.5,
              cursor: (allSelected && allOptionsValid) ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
            {t('customer.confirmAdd', 'Add to Cart')}
            <span style={{ fontWeight: 700 }}>€{(offer.bundlePrice + totalOptionExtra).toFixed(2)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
