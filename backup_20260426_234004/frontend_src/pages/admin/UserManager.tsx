import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';

interface AdminUser { _id: string; username: string; role: string; }

export default function UserManager() {
  const { t } = useTranslation();
  const { token } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'owner' | 'cashier'>('cashier');

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const fetchUsers = useCallback(async () => {
    const res = await fetch('/api/admin/users', { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setUsers(await res.json());
  }, [token]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const startEdit = (user: AdminUser | null) => {
    if (user) {
      setEditingId(user._id);
      setUsername(user.username);
      setRole(user.role as 'owner' | 'cashier');
      setPassword('');
    } else {
      setEditingId(null);
      setUsername('');
      setPassword('');
      setRole('cashier');
    }
    setShowForm(true);
  };

  const handleSave = async () => {
    const body: Record<string, string> = { username, role };
    if (password) body.password = password;
    if (editingId) {
      await fetch(`/api/admin/users/${editingId}`, { method: 'PUT', headers, body: JSON.stringify(body) });
    } else {
      await fetch('/api/admin/users', { method: 'POST', headers, body: JSON.stringify(body) });
    }
    setShowForm(false);
    fetchUsers();
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('common.confirm') + '?')) return;
    await fetch(`/api/admin/users/${id}`, { method: 'DELETE', headers });
    fetchUsers();
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>{t('admin.users')}</h2>
        <button className="btn btn-primary" onClick={() => startEdit(null)}>{t('common.add')}</button>
      </div>

      {showForm && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: 'var(--text-light)', display: 'block', marginBottom: 4 }}>用户名</label>
              <input className="input" value={username} onChange={e => setUsername(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--text-light)', display: 'block', marginBottom: 4 }}>密码{editingId ? ' (留空不修改)' : ''}</label>
              <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--text-light)', display: 'block', marginBottom: 4 }}>角色</label>
              <select className="input" value={role} onChange={e => setRole(e.target.value as 'owner' | 'cashier')}>
                <option value="owner">老板 (Owner)</option>
                <option value="cashier">收银员 (Cashier)</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn btn-primary" onClick={handleSave}>{t('common.save')}</button>
            <button className="btn btn-outline" onClick={() => setShowForm(false)}>{t('common.cancel')}</button>
          </div>
        </div>
      )}

      <div className="card" style={{ overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: 'var(--bg)', borderBottom: '2px solid var(--border)' }}>
              <th style={{ padding: '10px 16px', textAlign: 'left' }}>用户名</th>
              <th style={{ padding: '10px 16px', textAlign: 'left' }}>角色</th>
              <th style={{ padding: '10px 16px', textAlign: 'right' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u._id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={{ padding: '10px 16px', fontWeight: 600 }}>{u.username}</td>
                <td style={{ padding: '10px 16px' }}>
                  <span className="badge" style={{
                    background: u.role === 'owner' ? 'var(--gold-light)' : 'var(--blue-light)',
                    color: u.role === 'owner' ? 'var(--gold-dark)' : 'var(--blue)',
                  }}>{u.role === 'owner' ? '老板' : '收银员'}</span>
                </td>
                <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                  <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => startEdit(u)}>{t('common.edit')}</button>
                  <button className="btn btn-ghost" style={{ fontSize: 12, color: 'var(--red-primary)' }} onClick={() => handleDelete(u._id)}>{t('common.delete')}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
