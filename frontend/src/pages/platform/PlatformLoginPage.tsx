import { useState, useEffect, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export default function PlatformLoginPage() {
  const { platformLogin, user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isAuthenticated && user?.role === 'platform_owner') {
      navigate('/platform', { replace: true });
    }
  }, [isAuthenticated, user, navigate]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await platformLogin(username, password);
      navigate('/platform', { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(145deg, #1a237e 0%, #283593 40%, #3949ab 100%)',
      padding: 24,
      gap: 28,
    }}>
      <Link to="/" style={{ color: '#e8eaf6', fontSize: 13, textDecoration: 'none', opacity: 0.9 }}>
        ← 返回门户首页
      </Link>
      <div style={{
        background: '#fff',
        borderRadius: 16,
        padding: '36px 32px',
        width: '100%',
        maxWidth: 400,
        boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
      }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1a237e', marginBottom: 6, textAlign: 'center' }}>
          平台管理
        </h1>
        <p style={{ fontSize: 13, color: '#666', textAlign: 'center', marginBottom: 22 }}>
          超级管理员登录 · 管理店铺与账号
        </p>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <input
            className="input"
            type="text"
            placeholder="平台管理员用户名"
            value={username}
            onChange={e => setUsername(e.target.value)}
            required
            autoComplete="username"
          />
          <input
            className="input"
            type="password"
            placeholder="密码"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
          {error && <div style={{ color: '#c62828', fontSize: 13 }}>{error}</div>}
          <button className="btn btn-primary" type="submit" disabled={loading}
            style={{ width: '100%', padding: '12px 0', background: '#1a237e', border: 'none' }}>
            {loading ? '登录中…' : '登录'}
          </button>
        </form>
      </div>

      {isAuthenticated && user && user.role !== 'platform_owner' && (
        <p style={{ fontSize: 12, color: '#e8eaf6' }}>
          当前已登录店铺账号（{user.username}）。
          <button type="button" onClick={() => logout()} style={{ marginLeft: 8, background: 'none', border: 'none', color: '#ffecb3', cursor: 'pointer', textDecoration: 'underline' }}>
            退出后登录平台
          </button>
        </p>
      )}

    </div>
  );
}
