import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';

interface BusinessSlot {
  start: string;
  end: string;
}

const EMPTY_SLOT: BusinessSlot = { start: '09:00', end: '21:00' };

function parseSlots(raw?: string): BusinessSlot[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s) => typeof s?.start === 'string' && typeof s?.end === 'string')
      .map((s) => ({ start: s.start, end: s.end }));
  } catch {
    return [];
  }
}

function parseClosedDates(raw?: string): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((d) => typeof d === 'string');
  } catch {
    return [];
  }
}

export default function BusinessHours() {
  const { token } = useAuth();
  const [slots, setSlots] = useState<BusinessSlot[]>([]);
  const [closedDates, setClosedDates] = useState<string[]>([]);
  const [newClosedDate, setNewClosedDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const fetchConfig = useCallback(async () => {
    const res = await fetch('/api/admin/config', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    const data = await res.json() as Record<string, string>;
    setSlots(parseSlots(data.business_hours_slots));
    setClosedDates(parseClosedDates(data.business_closed_dates));
  }, [token]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const save = async () => {
    setSaving(true);
    setMessage('');
    try {
      const payload = {
        business_hours_slots: JSON.stringify(slots),
        business_closed_dates: JSON.stringify([...new Set(closedDates)].sort()),
      };
      const res = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setMessage('保存成功');
      } else {
        setMessage('保存失败');
      }
    } catch {
      setMessage('保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>营业时间设置</h2>
      <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <section>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>营业时段</h3>
          <p style={{ fontSize: 12, color: 'var(--text-light)', marginBottom: 12 }}>
            仅在以下时段允许客户扫码访问菜单。可配置多个时段（例如午市和晚市）。
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {slots.map((slot, idx) => (
              <div key={`${slot.start}-${slot.end}-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="time"
                  className="input"
                  value={slot.start}
                  onChange={(e) => setSlots((prev) => prev.map((s, i) => (i === idx ? { ...s, start: e.target.value } : s)))}
                  style={{ maxWidth: 140 }}
                />
                <span>至</span>
                <input
                  type="time"
                  className="input"
                  value={slot.end}
                  onChange={(e) => setSlots((prev) => prev.map((s, i) => (i === idx ? { ...s, end: e.target.value } : s)))}
                  style={{ maxWidth: 140 }}
                />
                <button
                  className="btn btn-outline"
                  onClick={() => setSlots((prev) => prev.filter((_, i) => i !== idx))}
                  style={{ fontSize: 12 }}
                >
                  删除
                </button>
              </div>
            ))}
            {slots.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-light)' }}>未配置时段时默认全天可访问</div>}
            <div>
              <button className="btn btn-outline" onClick={() => setSlots((prev) => [...prev, { ...EMPTY_SLOT }])}>
                + 添加时段
              </button>
            </div>
          </div>
        </section>

        <section>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>休息日期（优先级更高）</h3>
          <p style={{ fontSize: 12, color: 'var(--text-light)', marginBottom: 12 }}>
            休息日期将覆盖营业时段，在这些日期客户不可扫码访问菜单。
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
            <input
              type="date"
              className="input"
              value={newClosedDate}
              onChange={(e) => setNewClosedDate(e.target.value)}
              style={{ maxWidth: 180 }}
            />
            <button
              className="btn btn-outline"
              onClick={() => {
                if (!newClosedDate) return;
                setClosedDates((prev) => Array.from(new Set([...prev, newClosedDate])).sort());
                setNewClosedDate('');
              }}
            >
              + 添加休息日
            </button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {closedDates.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-light)' }}>暂无休息日期</div>}
            {closedDates.map((date) => (
              <div key={date} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--red-light)', color: 'var(--red-primary)', borderRadius: 999, padding: '6px 10px', fontSize: 12 }}>
                <span>{date}</span>
                <button
                  onClick={() => setClosedDates((prev) => prev.filter((d) => d !== date))}
                  style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--red-primary)', fontSize: 12 }}
                  aria-label={`remove-${date}`}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </section>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </button>
          {message && <span style={{ fontSize: 12, color: 'var(--text-light)' }}>{message}</span>}
        </div>
      </div>
    </div>
  );
}
