import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CartItemOption } from '../../context/CartContext';

interface OptionChoice {
  _id: string;
  extraPrice: number;
  originalPrice?: number;
  translations: { locale: string; name: string }[];
}

export interface OptionGroup {
  _id: string;
  required: boolean;
  translations: { locale: string; name: string }[];
  choices: OptionChoice[];
}

interface Props {
  itemName: string;
  price: number;
  optionGroups: OptionGroup[];
  onConfirm: (options: CartItemOption[]) => void;
  onClose: () => void;
}

export default function OptionSelectModal({ itemName, price, optionGroups, onConfirm, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  const getName = (translations: { locale: string; name: string }[]) => {
    const found = translations.find(t2 => t2.locale === lang) || translations[0];
    return found?.name || '';
  };

  const getNameMap = (translations: { locale: string; name: string }[]): Record<string, string> =>
    Object.fromEntries(translations.map(t2 => [t2.locale, t2.name]));

  // selections: groupId -> choiceId (single) for required, groupId -> choiceId[] (multi) for optional
  const [singleSelections, setSingleSelections] = useState<Record<string, string>>({});
  const [multiSelections, setMultiSelections] = useState<Record<string, string[]>>({});

  const canConfirm = optionGroups.every(g => !g.required || singleSelections[g._id]);

  const toggleSingle = (groupId: string, choiceId: string) => {
    setSingleSelections(prev => {
      const next = { ...prev };
      if (next[groupId] === choiceId) delete next[groupId];
      else next[groupId] = choiceId;
      return next;
    });
  };

  const toggleMulti = (groupId: string, choiceId: string) => {
    setMultiSelections(prev => {
      const current = prev[groupId] || [];
      const next = current.includes(choiceId)
        ? current.filter(id => id !== choiceId)
        : [...current, choiceId];
      return { ...prev, [groupId]: next };
    });
  };

  const handleConfirm = () => {
    const options: CartItemOption[] = [];
    for (const group of optionGroups) {
      if (group.required) {
        // Single select
        const choiceId = singleSelections[group._id];
        if (!choiceId) continue;
        const choice = group.choices.find(c => c._id === choiceId);
        if (!choice) continue;
        options.push({
          groupId: group._id, choiceId: choice._id,
          groupName: getNameMap(group.translations), choiceName: getNameMap(choice.translations),
          extraPrice: choice.extraPrice || 0,
        });
      } else {
        // Multi select
        const choiceIds = multiSelections[group._id] || [];
        for (const choiceId of choiceIds) {
          const choice = group.choices.find(c => c._id === choiceId);
          if (!choice) continue;
          options.push({
            groupId: group._id, choiceId: choice._id,
            groupName: getNameMap(group.translations), choiceName: getNameMap(choice.translations),
            extraPrice: choice.extraPrice || 0,
          });
        }
      }
    }
    onConfirm(options);
  };

  const totalExtra = (() => {
    let sum = 0;
    for (const group of optionGroups) {
      if (group.required) {
        const cId = singleSelections[group._id];
        if (cId) { const c = group.choices.find(x => x._id === cId); sum += c?.extraPrice || 0; }
      } else {
        for (const cId of (multiSelections[group._id] || [])) {
          const c = group.choices.find(x => x._id === cId); sum += c?.extraPrice || 0;
        }
      }
    }
    return sum;
  })();

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--bg-white, #fff)', borderRadius: '16px 16px 0 0',
        width: '100%', maxWidth: 430, maxHeight: '80vh', display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border, #eee)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-dark)' }}>{itemName}</div>
            <div style={{ fontSize: 14, color: 'var(--red-primary)', fontWeight: 600 }}>€{price}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, color: 'var(--text-light)', cursor: 'pointer', padding: 4 }}>✕</button>
        </div>

        {/* Option groups */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
          {optionGroups.map(group => (
            <div key={group._id} style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                {getName(group.translations)}
                {group.required
                  ? <span style={{ fontSize: 11, color: '#fff', background: 'var(--red-primary)', padding: '1px 6px', borderRadius: 4 }}>{t('admin.required')}</span>
                  : <span style={{ fontSize: 11, color: 'var(--text-light)', padding: '1px 6px', borderRadius: 4, border: '1px solid var(--border)' }}>多选</span>
                }
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
                {group.choices.map(choice => {
                  const selected = group.required
                    ? singleSelections[group._id] === choice._id
                    : (multiSelections[group._id] || []).includes(choice._id);
                  return (
                    <div key={choice._id} onClick={() => group.required ? toggleSingle(group._id, choice._id) : toggleMulti(group._id, choice._id)}
                      style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                        padding: '10px 8px', borderRadius: 10, cursor: 'pointer', transition: 'all 0.12s',
                        border: selected ? '2px solid var(--red-primary)' : '1px solid var(--border, #ddd)',
                        background: selected ? 'var(--red-light, #FFF5F5)' : 'var(--bg, #fafafa)',
                        textAlign: 'center', minHeight: 52,
                      }}>
                      <span style={{ fontSize: 13, fontWeight: selected ? 700 : 500, lineHeight: 1.3, color: selected ? 'var(--red-primary)' : 'var(--text-dark)' }}>
                        {getName(choice.translations)}
                      </span>
                      {(choice.extraPrice > 0 || (choice.originalPrice && choice.originalPrice > choice.extraPrice)) && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                          {choice.originalPrice && choice.originalPrice > choice.extraPrice && (
                            <span style={{ fontSize: 10, color: 'var(--text-light)', textDecoration: 'line-through' }}>+€{choice.originalPrice}</span>
                          )}
                          {choice.extraPrice > 0 && (
                            <span style={{ fontSize: 11, color: 'var(--red-primary)', fontWeight: 600 }}>+€{choice.extraPrice}</span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px 20px', borderTop: '1px solid var(--border, #eee)' }}>
          <button onClick={handleConfirm} disabled={!canConfirm}
            className="btn btn-primary"
            style={{
              width: '100%', padding: '14px 0', fontSize: 15, letterSpacing: 1,
              opacity: canConfirm ? 1 : 0.5, cursor: canConfirm ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
            {t('customer.confirmAdd')}
            <span style={{ fontWeight: 700 }}>€{(price + totalExtra).toFixed(2)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
