import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';
import { io } from 'socket.io-client';
import { playDineInSound, playTakeoutSound, unlockAudio } from '../utils/orderSound';
import { printViaIframe } from '../components/cashier/ReceiptPrint';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { useRestaurantConfig } from '../hooks/useRestaurantConfig';

export default function CashierLayout() {
  const { user, logout, token } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { displayName } = useRestaurantConfig();
  // Show settle button only between 20:30 and 23:59
  const [showSettle, setShowSettle] = useState(false);
  const [settling, setSettling] = useState(false);
  useEffect(() => {
    const check = () => {
      const now = new Date();
      const h = now.getHours();
      const m = now.getMinutes();
      setShowSettle(h > 20 || (h === 20 && m >= 30));
    };
    check();
    const id = setInterval(check, 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const handler = () => unlockAudio();
    document.addEventListener('click', handler, { once: true });
    document.addEventListener('touchstart', handler, { once: true });
    return () => { document.removeEventListener('click', handler); document.removeEventListener('touchstart', handler); };
  }, []);

  useEffect(() => {
    const socket = io({ transports: ['websocket'] });
    socket.on('order:new', (order: { type?: string }) => {
      if (order?.type === 'takeout') playTakeoutSound();
      else playDineInSound();
    });
    return () => { socket.disconnect(); };
  }, []);

  const handleLogout = () => { logout(); navigate('/login'); };

  const handleSettle = useCallback(async () => {
    setSettling(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const [statsRes, configRes] = await Promise.all([
        fetch(`/api/reports/detailed?startDate=${today}&endDate=${today}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/admin/config'),
      ]);
      if (!statsRes.ok) { alert('Failed to load report'); return; }
      const stats = await statsRes.json();
      const config = configRes.ok ? await configRes.json() : {};

      const name = config.restaurant_name_en || config.restaurant_name_zh || '';
      const addr = config.restaurant_address || '';
      const now = new Date();
      const dateStr = now.toLocaleDateString('en-GB');
      const timeStr = now.toLocaleTimeString('en-GB');

      let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        * { margin:0; padding:0; box-sizing:border-box; }
        body { font-family:Arial,Helvetica,sans-serif; font-size:15px; font-weight:bold; color:#000; max-width:420px; margin:0 auto; padding:14px; }
        .center { text-align:center; }
        .divider { border-top:2px dashed #000; margin:10px 0; }
        .row { display:flex; justify-content:space-between; margin:4px 0; }
        .big { font-size:18px; margin:6px 0; }
        .section { margin:4px 0; font-size:14px; text-decoration:underline; }
        @media print { body { -webkit-print-color-adjust:exact; print-color-adjust:exact; } @page { margin:0; size:80mm auto; } }
      </style></head><body>`;

      // Header
      html += `<div class="center">`;
      if (name) html += `<div style="font-size:18px;margin-bottom:4px">${name}</div>`;
      if (addr) html += `<div style="font-size:13px">${addr}</div>`;
      html += `<div class="big">DAILY SETTLEMENT</div>`;
      html += `<div style="font-size:13px">${dateStr} ${timeStr}</div>`;
      html += `</div><div class="divider"></div>`;

      // Cash (net of refunds)
      html += `<div class="row" style="font-size:16px"><span>Cash</span><span>€${(stats.cashTotal ?? 0).toFixed(2)}</span></div>`;

      // Card (net of refunds)
      html += `<div class="row" style="font-size:16px"><span>Card</span><span>€${(stats.cardTotal ?? 0).toFixed(2)}</span></div>`;

      // Footer
      html += `<div class="divider"></div>`;
      html += `<div class="center" style="font-size:12px;margin-top:4px">Printed by ${user?.username || ''} at ${timeStr}</div>`;
      html += `</body></html>`;

      printViaIframe(html, 1);
    } catch {
      alert('Settlement failed');
    } finally {
      setSettling(false);
    }
  }, [token, user]);

  const tabStyle = (isActive: boolean): React.CSSProperties => ({
    padding: '12px 24px', fontWeight: isActive ? 700 : 500, fontSize: 14,
    color: isActive ? 'var(--red-primary)' : 'var(--text-secondary)',
    borderBottom: isActive ? '3px solid var(--red-primary)' : '3px solid transparent',
    background: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
    textDecoration: 'none', display: 'inline-block',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Top Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '10px 20px', background: 'var(--bg-white)',
        borderBottom: '2px solid var(--border)', flexShrink: 0,
      }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--red-primary)', fontFamily: 'var(--font-heading)' }}>
          {displayName} · {t('cashier.title')}
        </h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 13, color: 'var(--text-secondary)' }}>
          {showSettle && (
            <button className="btn" onClick={handleSettle} disabled={settling}
              style={{ padding: '5px 14px', fontSize: 12, background: '#4CAF50', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600 }}>
              {settling ? '...' : '💰 结账'}
            </button>
          )}
          <LanguageSwitcher />
          <span style={{ fontWeight: 600 }}>{user?.username}</span>
          <button className="btn btn-outline" style={{ padding: '6px 14px', fontSize: 12 }} onClick={handleLogout}>
            {t('login.logout', '退出')}
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div style={{
        display: 'flex', gap: 0, background: 'var(--bg-white)',
        borderBottom: '2px solid var(--border)', flexShrink: 0, paddingLeft: 16,
      }}>
        <NavLink to="/cashier" end style={({ isActive }) => tabStyle(isActive)}>{t('cashier.dineIn')}</NavLink>
        <NavLink to="/cashier/takeout" style={({ isActive }) => tabStyle(isActive)}>{t('cashier.takeout')}</NavLink>
        <NavLink to="/cashier/delivery" style={({ isActive }) => tabStyle(isActive)}>{t('cashier.delivery')}</NavLink>
        <NavLink to="/cashier/phone" style={({ isActive }) => tabStyle(isActive)}>📞 {t('cashier.phone', 'Phone')}</NavLink>
        <NavLink to="/cashier/order" style={({ isActive }) => tabStyle(isActive)}>{t('cashier.newOrder', '点单')}</NavLink>
        <NavLink to="/cashier/reprint" style={({ isActive }) => tabStyle(isActive)}>{t('cashier.reprint', '重印小票')}</NavLink>
        <NavLink to="/cashier/inventory" style={({ isActive }) => tabStyle(isActive)}>{t('admin.inventory', '库存')}</NavLink>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        <Outlet />
      </div>
    </div>
  );
}
