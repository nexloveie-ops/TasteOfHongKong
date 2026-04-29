import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';

interface ConfigEntry { key: string; value: string; }

export default function SystemConfig() {
  const { t } = useTranslation();
  const { token } = useAuth();
  const [configs, setConfigs] = useState<ConfigEntry[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const fetchConfig = useCallback(async () => {
    const res = await fetch('/api/admin/config', { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      const data = await res.json();
      // data could be an object or array
      if (Array.isArray(data)) {
        setConfigs(data);
        const map: Record<string, string> = {};
        data.forEach((c: ConfigEntry) => { map[c.key] = c.value; });
        setEdits(map);
      } else {
        const entries = Object.entries(data).map(([key, value]) => ({ key, value: String(value) }));
        setConfigs(entries);
        setEdits(data);
      }
    }
  }, [token]);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch('/api/admin/config', { method: 'PUT', headers, body: JSON.stringify(edits) });
      fetchConfig();
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  const configLabels: Record<string, string> = {
    receipt_print_copies: '小票打印份数',
    restaurant_name: '餐厅名称',
  };

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>{t('admin.systemConfig')}</h2>

      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {configs.map(c => (
            <div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <label style={{ width: 180, fontSize: 14, fontWeight: 500, color: 'var(--text-secondary)' }}>
                {configLabels[c.key] || c.key}
              </label>
              <input
                className="input"
                value={edits[c.key] || ''}
                onChange={e => setEdits(prev => ({ ...prev, [c.key]: e.target.value }))}
                style={{ maxWidth: 300 }}
              />
            </div>
          ))}
          {configs.length === 0 && (
            <div style={{ color: 'var(--text-light)', textAlign: 'center', padding: 20 }}>暂无配置项</div>
          )}
        </div>
        <div style={{ marginTop: 20 }}>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? t('common.loading') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
