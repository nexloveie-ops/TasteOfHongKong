import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { configureApiClient } from '../api/client';

export default function PlatformLayout() {
  const { token, user, logout } = useAuth();
  const navigate = useNavigate();

  configureApiClient(() => '', () => token);

  const handleLogout = () => {
    logout();
    navigate('/', { replace: true });
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f0f2f8', display: 'flex', flexDirection: 'column' }}>
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 24px',
        background: '#1a237e',
        color: '#fff',
        flexShrink: 0,
      }}>
        <div style={{ fontWeight: 700, fontSize: 17 }}>平台管理 · {user?.username}</div>
        <button type="button" className="btn btn-outline" onClick={handleLogout}
          style={{ borderColor: '#9fa8da', color: '#e8eaf6', fontSize: 13 }}>
          退出
        </button>
      </header>
      <nav
        style={{
          display: 'flex',
          gap: 4,
          padding: '0 24px',
          background: '#283593',
          flexShrink: 0,
          borderBottom: '1px solid rgba(255,255,255,0.12)',
        }}
        aria-label="平台模块"
      >
        <NavLink
          to="/platform/stores"
          end
          style={({ isActive }) => ({
            padding: '12px 18px',
            color: isActive ? '#fff' : 'rgba(232,234,246,0.85)',
            textDecoration: 'none',
            fontSize: 14,
            fontWeight: isActive ? 600 : 500,
            borderBottom: isActive ? '3px solid #fff' : '3px solid transparent',
            marginBottom: -1,
          })}
        >
          店铺管理
        </NavLink>
        <NavLink
          to="/platform/ads"
          style={({ isActive }) => ({
            padding: '12px 18px',
            color: isActive ? '#fff' : 'rgba(232,234,246,0.85)',
            textDecoration: 'none',
            fontSize: 14,
            fontWeight: isActive ? 600 : 500,
            borderBottom: isActive ? '3px solid #fff' : '3px solid transparent',
            marginBottom: -1,
          })}
        >
          下单完成广告
        </NavLink>
      </nav>
      <main style={{ flex: 1, padding: 24, maxWidth: 1100, margin: '0 auto', width: '100%' }}>
        <Outlet />
      </main>
    </div>
  );
}
