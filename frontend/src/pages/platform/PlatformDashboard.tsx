import { Fragment, useCallback, useEffect, useState } from 'react';
import { platformApiFetch } from '../../api/client';

interface StoreRow {
  _id: string;
  slug: string;
  displayName: string;
  status: string;
  subscriptionEndsAt?: string;
}

interface AdminRow {
  _id: string;
  username: string;
  role: string;
}

export default function PlatformDashboard() {
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const [newSlug, setNewSlug] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [adminsByStore, setAdminsByStore] = useState<Record<string, AdminRow[]>>({});
  const [admLoad, setAdmLoad] = useState<string | null>(null);

  const [newAdminUser, setNewAdminUser] = useState('');
  const [newAdminPass, setNewAdminPass] = useState('');
  const [newAdminRole, setNewAdminRole] = useState<'owner' | 'cashier'>('owner');
  const [addingAdmin, setAddingAdmin] = useState(false);

  const loadStores = useCallback(async () => {
    setErr('');
    const res = await platformApiFetch('/api/platform/stores');
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error?.message || '加载失败');
      setStores([]);
      return;
    }
    setStores(await res.json());
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await loadStores();
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [loadStores]);

  const loadAdmins = async (storeId: string) => {
    setAdmLoad(storeId);
    try {
      const res = await platformApiFetch(`/api/platform/stores/${storeId}/admins`);
      if (res.ok) {
        const list = await res.json();
        setAdminsByStore(prev => ({ ...prev, [storeId]: list }));
      }
    } finally {
      setAdmLoad(null);
    }
  };

  const toggleExpand = (id: string) => {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    if (!adminsByStore[id]) void loadAdmins(id);
  };

  const createStore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSlug.trim() || !newName.trim()) return;
    setCreating(true);
    setErr('');
    try {
      const res = await platformApiFetch('/api/platform/stores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: newSlug.trim().toLowerCase(), displayName: newName.trim() }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error?.message || '创建失败');
        return;
      }
      setNewSlug('');
      setNewName('');
      await loadStores();
    } finally {
      setCreating(false);
    }
  };

  const patchStore = async (id: string, body: Record<string, unknown>) => {
    const res = await platformApiFetch(`/api/platform/stores/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) await loadStores();
    else {
      const j = await res.json().catch(() => ({}));
      setErr(j.error?.message || '更新失败');
    }
  };

  const addAdmin = async (e: React.FormEvent, storeId: string) => {
    e.preventDefault();
    if (!newAdminUser.trim() || !newAdminPass) return;
    setAddingAdmin(true);
    setErr('');
    try {
      const res = await platformApiFetch(`/api/platform/stores/${storeId}/admins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: newAdminUser.trim(),
          password: newAdminPass,
          role: newAdminRole,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error?.message || '创建账号失败');
        return;
      }
      setNewAdminUser('');
      setNewAdminPass('');
      await loadAdmins(storeId);
    } finally {
      setAddingAdmin(false);
    }
  };

  const deleteAdmin = async (storeId: string, adminId: string) => {
    if (!confirm('确认删除该账号？')) return;
    const res = await platformApiFetch(`/api/platform/stores/${storeId}/admins/${adminId}`, { method: 'DELETE' });
    if (res.ok) await loadAdmins(storeId);
  };

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1a237e', marginBottom: 8 }}>店铺与账号</h1>
      <p style={{ fontSize: 14, color: '#555', marginBottom: 24, lineHeight: 1.6 }}>
        新建店铺时会分配 <strong>URL 标识（slug）</strong>。本地访问地址为{' '}
        <code>{`${origin}/{'{slug}'}/login`}</code>；若生产环境使用子域名，请在网关将{' '}
        <code>{'{slug}.你的域名.com'}</code> 指向前端同一应用，并由前端或网关解析出 slug（当前版本为路径前缀模式）。
      </p>

      {err && (
        <div style={{ padding: 12, background: '#ffebee', color: '#c62828', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>
          {err}
        </div>
      )}

      <div className="card" style={{ padding: 20, marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 14 }}>新建店铺</h2>
        <form onSubmit={createStore} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <div>
            <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>URL 标识（小写、数字、连字符）</label>
            <input className="input" style={{ width: 200 }} placeholder="例 my-shop" value={newSlug}
              onChange={e => setNewSlug(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>显示名称</label>
            <input className="input" style={{ width: 220 }} placeholder="例 某某茶餐厅" value={newName}
              onChange={e => setNewName(e.target.value)} />
          </div>
          <button type="submit" className="btn btn-primary" disabled={creating} style={{ background: '#1a237e' }}>
            {creating ? '创建中…' : '创建店铺'}
          </button>
        </form>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #eee', fontWeight: 600 }}>店铺列表</div>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>加载中…</div>
        ) : stores.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>暂无店铺</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#f5f5f5', textAlign: 'left' }}>
                <th style={{ padding: '12px 16px' }}>标识 / 登录路径</th>
                <th style={{ padding: '12px 16px' }}>名称</th>
                <th style={{ padding: '12px 16px' }}>状态</th>
                <th style={{ padding: '12px 16px' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {stores.map(s => (
                <Fragment key={s._id}>
                  <tr style={{ borderTop: '1px solid #eee' }}>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ fontWeight: 600 }}>{s.slug}</div>
                      <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                        <a href={`/${s.slug}/login`} target="_blank" rel="noreferrer">{`${origin}/${s.slug}/login`}</a>
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px' }}>{s.displayName}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <select
                        value={s.status}
                        onChange={e => patchStore(s._id, { status: e.target.value })}
                        style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #ccc' }}>
                        <option value="active">营业</option>
                        <option value="suspended">暂停</option>
                        <option value="expired">过期</option>
                      </select>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <button type="button" className="btn btn-outline" style={{ fontSize: 12, padding: '6px 12px' }}
                        onClick={() => toggleExpand(s._id)}>
                        {expanded === s._id ? '收起账号' : '管理店内账号'}
                      </button>
                    </td>
                  </tr>
                  {expanded === s._id && (
                    <tr>
                      <td colSpan={4} style={{ padding: '0 16px 20px', background: '#fafafa' }}>
                        <div style={{ padding: '16px 0' }}>
                          <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 13 }}>店内账号（店主 / 收银员）</div>
                          {admLoad === s._id ? (
                            <div style={{ color: '#888', fontSize: 13 }}>加载账号…</div>
                          ) : (
                            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px' }}>
                              {(adminsByStore[s._id] || []).map(a => (
                                <li key={a._id} style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  padding: '8px 12px',
                                  background: '#fff',
                                  borderRadius: 8,
                                  marginBottom: 8,
                                  border: '1px solid #eee',
                                }}>
                                  <span>{a.username} <span style={{ color: '#888' }}>({a.role})</span></span>
                                  <button type="button" className="btn btn-outline" style={{ fontSize: 12, color: '#c62828', borderColor: '#ffcdd2' }}
                                    onClick={() => deleteAdmin(s._id, a._id)}>删除</button>
                                </li>
                              ))}
                            </ul>
                          )}
                          <form onSubmit={e => addAdmin(e, s._id)} style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: 10,
                            alignItems: 'flex-end',
                            padding: 16,
                            background: '#fff',
                            borderRadius: 8,
                            border: '1px solid #e0e0e0',
                          }}>
                            <input className="input" style={{ width: 140 }} placeholder="用户名" value={newAdminUser}
                              onChange={e => setNewAdminUser(e.target.value)} />
                            <input className="input" style={{ width: 140 }} type="password" placeholder="初始密码" value={newAdminPass}
                              onChange={e => setNewAdminPass(e.target.value)} />
                            <select className="input" style={{ width: 120 }} value={newAdminRole}
                              onChange={e => setNewAdminRole(e.target.value as 'owner' | 'cashier')}>
                              <option value="owner">店主</option>
                              <option value="cashier">收银员</option>
                            </select>
                            <button type="submit" className="btn btn-primary" disabled={addingAdmin} style={{ background: '#3949ab' }}>
                              添加账号
                            </button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
