import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { apiFetch } from '../../api/client';

interface AllergenTranslation { locale: string; name: string; }
interface Allergen {
  _id: string;
  name: string;
  icon: string;
  translations: AllergenTranslation[];
}

const COMMON_ALLERGENS = [
  { icon: '🥜', zh: '花生', en: 'Peanut' },
  { icon: '🦐', zh: '甲壳类', en: 'Crustacean' },
  { icon: '🥛', zh: '乳制品', en: 'Dairy' },
  { icon: '🌾', zh: '麸质', en: 'Gluten' },
  { icon: '🥚', zh: '鸡蛋', en: 'Egg' },
  { icon: '🐟', zh: '鱼类', en: 'Fish' },
  { icon: '🫘', zh: '大豆', en: 'Soy' },
  { icon: '🌰', zh: '坚果', en: 'Tree Nut' },
  { icon: '🧅', zh: '芹菜', en: 'Celery' },
  { icon: '🫒', zh: '芝麻', en: 'Sesame' },
  { icon: '🐚', zh: '软体动物', en: 'Mollusc' },
  { icon: '🌿', zh: '芥末', en: 'Mustard' },
  { icon: '🧄', zh: '羽扇豆', en: 'Lupin' },
  { icon: '⚗️', zh: '亚硫酸盐', en: 'Sulphite' },
];

const emptyForm = { icon: '', nameZh: '', nameEn: '' };

export default function AllergenManager() {
  const { t } = useTranslation();
  const { token } = useAuth();
  const [allergens, setAllergens] = useState<Allergen[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const fetchAllergens = useCallback(async () => {
    const res = await apiFetch('/api/allergens', { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setAllergens(await res.json());
  }, [token]);

  useEffect(() => { fetchAllergens(); }, [fetchAllergens]);

  const startEdit = (a: Allergen | null) => {
    if (a) {
      setForm({
        icon: a.icon || '',
        nameZh: a.translations.find(t2 => t2.locale === 'zh-CN')?.name || '',
        nameEn: a.translations.find(t2 => t2.locale === 'en-US')?.name || '',
      });
      setEditingId(a._id);
    } else {
      setForm(emptyForm);
      setEditingId(null);
    }
    setShowForm(true);
    setError('');
  };

  const applySuggestion = (s: typeof COMMON_ALLERGENS[0]) => {
    setForm({ icon: s.icon, nameZh: s.zh, nameEn: s.en });
  };

  const handleSave = async () => {
    setError('');
    const body = {
      name: form.nameEn || form.nameZh,
      icon: form.icon,
      translations: [
        { locale: 'zh-CN', name: form.nameZh },
        { locale: 'en-US', name: form.nameEn },
      ],
    };
    const res = editingId
      ? await apiFetch(`/api/allergens/${editingId}`, { method: 'PUT', headers, body: JSON.stringify(body) })
      : await apiFetch('/api/allergens', { method: 'POST', headers, body: JSON.stringify(body) });
    if (res.ok) {
      setShowForm(false);
      fetchAllergens();
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('common.confirm') + '?')) return;
    const res = await apiFetch(`/api/allergens/${id}`, { method: 'DELETE', headers });
    if (res.ok) {
      fetchAllergens();
    } else {
      const data = await res.json().catch(() => null);
      if (res.status === 409) {
        setError(t('admin.allergenInUse'));
      } else {
        setError(data?.error?.message || t('common.error'));
      }
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>{t('admin.allergens')}</h2>
        <button className="btn btn-primary" onClick={() => startEdit(null)}>{t('common.add')}</button>
      </div>

      {error && <div style={{ color: 'var(--red-primary)', marginBottom: 12, fontSize: 13 }}>{error}</div>}

      {showForm && (
        <div className="card" style={{ padding: 20, marginBottom: 16 }}>
          {!editingId && (
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, color: 'var(--text-light)', display: 'block', marginBottom: 6 }}>常见过敏原</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {COMMON_ALLERGENS.map(s => (
                  <button key={s.en} className="btn btn-ghost" onClick={() => applySuggestion(s)}
                    style={{ fontSize: 12, padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 6 }}>
                    {s.icon} {s.zh}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: 'var(--text-light)', display: 'block', marginBottom: 4 }}>{t('admin.allergenIcon')}</label>
              <input className="input" value={form.icon} onChange={e => setForm({ ...form, icon: e.target.value })} placeholder="🥜" style={{ fontSize: 20, textAlign: 'center' }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--text-light)', display: 'block', marginBottom: 4 }}>中文名称</label>
              <input className="input" value={form.nameZh} onChange={e => setForm({ ...form, nameZh: e.target.value })} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--text-light)', display: 'block', marginBottom: 4 }}>English Name</label>
              <input className="input" value={form.nameEn} onChange={e => setForm({ ...form, nameEn: e.target.value })} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button className="btn btn-primary" onClick={handleSave}>{t('common.save')}</button>
            <button className="btn btn-outline" onClick={() => setShowForm(false)}>{t('common.cancel')}</button>
          </div>
        </div>
      )}

      <div className="card" style={{ overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--bg)', borderBottom: '2px solid var(--border)' }}>
              <th style={{ padding: '10px 12px', textAlign: 'center', width: 60 }}>{t('admin.allergenIcon')}</th>
              <th style={{ padding: '10px 12px', textAlign: 'left' }}>中文</th>
              <th style={{ padding: '10px 12px', textAlign: 'left' }}>English</th>
              <th style={{ padding: '10px 12px', textAlign: 'right' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {allergens.map(a => (
              <tr key={a._id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={{ padding: '8px 12px', textAlign: 'center', fontSize: 22 }}>{a.icon}</td>
                <td style={{ padding: '8px 12px', fontWeight: 600 }}>{a.translations.find(t2 => t2.locale === 'zh-CN')?.name}</td>
                <td style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>{a.translations.find(t2 => t2.locale === 'en-US')?.name}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                  <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => startEdit(a)}>{t('common.edit')}</button>
                  <button className="btn btn-ghost" style={{ fontSize: 12, color: 'var(--red-primary)' }} onClick={() => handleDelete(a._id)}>{t('common.delete')}</button>
                </td>
              </tr>
            ))}
            {allergens.length === 0 && (
              <tr><td colSpan={4} style={{ padding: 40, textAlign: 'center', color: 'var(--text-light)' }}>暂无过敏原</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
