import { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from 'react-i18next';

const sidebarItems = [
  { path: '/admin/restaurant', icon: '🏪', key: 'admin.restaurantInfo' },
  { path: '/admin/categories', icon: '📂', key: 'admin.categories' },
  { path: '/admin/menu-items', icon: '🍽️', key: 'admin.menuItems' },
  { path: '/admin/inventory', icon: '📦', key: 'admin.inventory' },
  { path: '/admin/allergens', icon: '⚠️', key: 'admin.allergens' },
  { path: '/admin/i18n', icon: '🌐', key: 'admin.i18nEditor' },
  { path: '/admin/qr-codes', icon: '📱', key: 'admin.qrCodes' },
  { path: '/admin/offers', icon: '🎁', key: 'admin.offers' },
  { path: '/admin/coupons', icon: '🎟️', key: 'admin.coupons' },
  { path: '/admin/orders', icon: '📋', key: 'admin.orderHistory' },
  { path: '/admin/reports', icon: '📊', key: 'admin.reports' },
  { path: '/admin/users', icon: '👥', key: 'admin.users' },
  { path: '/admin/config', icon: '⚙️', key: 'admin.systemConfig' },
];

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);

  const handleLogout = () => { logout(); navigate('/login'); };

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Sidebar */}
      <div style={{
        width: collapsed ? 56 : 220, flexShrink: 0, background: 'var(--bg-white)',
        borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column',
        overflow: 'hidden', transition: 'width 0.2s ease',
      }}>
        <div style={{
          padding: collapsed ? '16px 0' : '16px 20px', borderBottom: '1px solid var(--border)',
          fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 18,
          color: 'var(--red-primary)', letterSpacing: 2, textAlign: collapsed ? 'center' : 'left',
          whiteSpace: 'nowrap', overflow: 'hidden',
        }}>
          {collapsed ? '港' : '港知味'}
          {!collapsed && (
            <div style={{ fontSize: 10, color: 'var(--text-light)', letterSpacing: 3, fontFamily: 'var(--font-body)', fontWeight: 400 }}>
              {t('admin.title')}
            </div>
          )}
        </div>
        <nav style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {sidebarItems.map(item => (
            <NavLink key={item.path} to={item.path}
              title={collapsed ? t(item.key) : undefined}
              style={({ isActive }) => ({
                display: 'flex', alignItems: 'center', gap: 10,
                padding: collapsed ? '12px 0' : '12px 20px',
                justifyContent: collapsed ? 'center' : 'flex-start',
                fontSize: 13, fontWeight: isActive ? 600 : 400,
                color: isActive ? 'var(--red-primary)' : 'var(--text-secondary)',
                background: isActive ? 'var(--red-light)' : 'transparent',
                borderLeft: isActive ? '4px solid var(--red-primary)' : '4px solid transparent',
                textDecoration: 'none', transition: 'var(--transition)',
                whiteSpace: 'nowrap', overflow: 'hidden',
              })}
            >
              <span style={{ fontSize: 16, flexShrink: 0 }}>{item.icon}</span>
              {!collapsed && t(item.key)}
            </NavLink>
          ))}
        </nav>
        {/* Toggle button */}
        <button onClick={() => setCollapsed(!collapsed)} style={{
          padding: '10px 0', border: 'none', borderTop: '1px solid var(--border)',
          background: 'var(--bg)', cursor: 'pointer', fontSize: 16, color: 'var(--text-light)',
        }}>
          {collapsed ? '»' : '«'}
        </button>
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Top bar */}
        <div style={{
          display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12,
          padding: '10px 20px', background: 'var(--bg-white)',
          borderBottom: '1px solid var(--border)', flexShrink: 0, fontSize: 13,
        }}>
          <span style={{ fontWeight: 600 }}>{user?.username}</span>
          <button className="btn btn-outline" style={{ padding: '6px 14px', fontSize: 12 }} onClick={handleLogout}>
            {t('login.logout', '退出')}
          </button>
        </div>
        {/* Content */}
        <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
          <Outlet />
        </div>
      </div>
    </div>
  );
}
