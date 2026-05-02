import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from 'react-i18next';
import { useRestaurantConfig } from '../hooks/useRestaurantConfig';

export default function LoginPage() {
  const { login, user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { displayName, displayNameEn, config } = useRestaurantConfig();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const logoUrl = config.restaurant_logo || '/logo.jpg';

  useEffect(() => {
    if (isAuthenticated && user) {
      const target = user.role === 'owner' ? '/admin' : '/cashier';
      navigate(target, { replace: true });
    }
  }, [isAuthenticated, user, navigate]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #B71C1C 0%, #D32F2F 50%, #E53935 100%)',
      padding: 20, overflow: 'auto',
    }}>
      <div style={{
        background: '#fff', borderRadius: 16, padding: '40px 32px', width: '100%', maxWidth: 380,
        boxShadow: '0 8px 32px rgba(0,0,0,0.2)', textAlign: 'center',
      }}>
        <div style={{ marginBottom: 8 }}>
          <img src={logoUrl} alt="Logo" style={{ width: 80, height: 80, borderRadius: '50%', objectFit: 'cover' }} />
        </div>
        <h1 style={{
          fontFamily: "'Noto Serif SC', serif", fontSize: 28, fontWeight: 700,
          color: '#D32F2F', letterSpacing: 3, marginBottom: 4,
        }}>{displayName}</h1>
        <div style={{
          fontSize: 11, letterSpacing: 4, color: '#999', marginBottom: 24, textTransform: 'uppercase',
        }}>{displayNameEn}</div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <input
            className="input"
            type="text"
            placeholder={t('login.username', '用户名')}
            value={username}
            onChange={e => setUsername(e.target.value)}
            required
            autoComplete="username"
          />
          <input
            className="input"
            type="password"
            placeholder={t('login.password', '密码')}
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
          {error && <div style={{ color: '#D32F2F', fontSize: 13 }}>{error}</div>}
          <button className="btn btn-primary" type="submit" disabled={loading}
            style={{ width: '100%', fontSize: 16, padding: '12px 0', marginTop: 4 }}>
            {loading ? t('common.loading') : t('login.submit', '登录')}
          </button>
        </form>
      </div>
    </div>
  );
}
