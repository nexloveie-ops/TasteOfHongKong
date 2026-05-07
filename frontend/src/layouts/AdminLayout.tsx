import { useState } from 'react';
import { Outlet, NavLink, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { useRestaurantConfig } from '../hooks/useRestaurantConfig';

const sidebarItems = [
  { path: 'restaurant', icon: '🏪', key: 'admin.restaurantInfo' },
  { path: 'delivery-fees', icon: '🚚', key: 'admin.deliveryFeesNav', featureKey: 'cashier.delivery.page' },
  { path: 'categories', icon: '📂', key: 'admin.categories' },
  { path: 'menu-items', icon: '🍽️', key: 'admin.menuItems' },
  { path: 'option-group-templates', icon: '🧩', key: 'admin.optionGroupTemplatesNav', featureKey: 'admin.optionGroupTemplates.page' },
  { path: 'inventory', icon: '📦', key: 'admin.inventory' },
  { path: 'allergens', icon: '⚠️', key: 'admin.allergens' },
  { path: 'i18n', icon: '🌐', key: 'admin.i18nEditor' },
  { path: 'qr-codes', icon: '📱', key: 'admin.qrCodes' },
  { path: 'offers', icon: '🎁', key: 'admin.offers', featureKey: 'admin.offers.page' },
  { path: 'coupons', icon: '🎟️', key: 'admin.coupons', featureKey: 'admin.coupons.page' },
  { path: 'orders', icon: '📋', key: 'admin.orderHistory', featureKey: 'admin.orderHistory.page' },
  { path: 'reports', icon: '📊', key: 'admin.reports' },
  { path: 'business-hours', icon: '🕒', key: 'admin.businessHours' },
  { path: 'users', icon: '👥', key: 'admin.users' },
  { path: 'config', icon: '⚙️', key: 'admin.systemConfig' },
  { path: 'stripe', icon: '💳', key: 'admin.stripeSettings' },
];

export default function AdminLayout() {
  const { user, logout, hasFeature } = useAuth();
  const { storeSlug } = useParams<{ storeSlug: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { displayName } = useRestaurantConfig();
  const [collapsed, setCollapsed] = useState(false);

  const handleLogout = () => {
    logout();
    navigate(`/${storeSlug}/login`);
  };

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
          {collapsed ? (displayName ? displayName.charAt(0) : '🏪') : displayName}
          {!collapsed && (
            <div style={{ fontSize: 10, color: 'var(--text-light)', letterSpacing: 3, fontFamily: 'var(--font-body)', fontWeight: 400 }}>
              {t('admin.title')}
            </div>
          )}
        </div>
        <nav style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {sidebarItems.filter(item => !item.featureKey || hasFeature(item.featureKey)).map(item => (
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
          <LanguageSwitcher />
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
