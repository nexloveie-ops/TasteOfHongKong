import { useMemo, useEffect } from 'react';
import type { CSSProperties } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useRestaurantConfig } from '../../hooks/useRestaurantConfig';
import { useBusinessStatus } from '../../hooks/useBusinessStatus';
import { useStoreSlug } from '../../context/StoreContext';
import MenuView from './MenuView';
import BannerPlatformCredit from '../../components/customer/BannerPlatformCredit';

function parseHoursSlots(raw?: string): { start: string; end: string }[] {
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

export default function StoreFrontPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const storeSlug = useStoreSlug();
  const [searchParams, setSearchParams] = useSearchParams();
  const { config, displayName, displayNameOther } = useRestaurantConfig();
  const { isOpen, loading: hoursLoading, deliveryEnabled, memberWalletEnabled } = useBusinessStatus();
  const canDelivery = deliveryEnabled !== false;
  const canMemberPortal = memberWalletEnabled !== false;

  const orderType = searchParams.get('type');
  const showMenu = orderType === 'takeout' || (orderType === 'delivery' && canDelivery);

  useEffect(() => {
    if (hoursLoading) return;
    if (orderType === 'delivery' && !canDelivery) {
      const next = new URLSearchParams(searchParams);
      next.delete('type');
      setSearchParams(next, { replace: true });
    }
  }, [orderType, canDelivery, hoursLoading, searchParams, setSearchParams]);

  const phone = (config.restaurant_phone || '').trim();
  const address = (config.restaurant_address || '').trim();
  const email = (config.restaurant_email || '').trim();
  const storeTitle = displayName || storeSlug;
  const slots = useMemo(() => parseHoursSlots(config.business_hours_slots), [config.business_hours_slots]);

  const mapHref = address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
    : '';

  const mapEmbedSrc = useMemo(() => {
    const a = address.trim();
    if (!a) return null;
    const qEnc = encodeURIComponent(a);
    const hl = lang.startsWith('zh') ? 'zh-CN' : 'en';
    const embedKey = (import.meta.env.VITE_GOOGLE_MAPS_EMBED_KEY || '').trim();
    if (embedKey) {
      const langParam = lang.startsWith('zh') ? 'zh-CN' : 'en';
      return `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(embedKey)}&q=${qEnc}&language=${encodeURIComponent(langParam)}`;
    }
    return `https://www.google.com/maps?q=${qEnc}&output=embed&z=16&hl=${encodeURIComponent(hl)}`;
  }, [address, lang]);

  const setMode = (type: 'delivery' | 'takeout') => {
    const next = new URLSearchParams(searchParams);
    next.set('type', type);
    setSearchParams(next, { replace: false });
  };

  const infoCardStyle: CSSProperties = {
    background: 'var(--bg-white)',
    borderRadius: 12,
    padding: '12px 14px',
    border: '1px solid rgba(232,213,184,0.55)',
    boxShadow: '0 2px 12px rgba(196,30,36,0.06)',
    display: 'flex',
    gap: 10,
    alignItems: 'flex-start',
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100%',
        // Landing: flex-shrink 0 so this column is not squashed inside CustomerLayout’s flex outlet (else overflow:hidden clips and parent won’t scroll).
        ...(showMenu ? { flex: 1, minHeight: 0, height: '100%', overflow: 'hidden' } : { flexShrink: 0 }),
      }}
    >
      {!showMenu ? (
        <div
          style={{
            flex: 1,
            position: 'relative',
            overflow: 'hidden',
            background: 'linear-gradient(165deg, #fff5f0 0%, #ffe8e0 28%, #fff9f5 55%, #faf6f0 100%)',
          }}
        >
          <div
            aria-hidden
            style={{
              position: 'absolute',
              width: 220,
              height: 220,
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(196,30,36,0.14) 0%, transparent 70%)',
              top: -80,
              right: -60,
              pointerEvents: 'none',
            }}
          />
          <div
            aria-hidden
            style={{
              position: 'absolute',
              width: 180,
              height: 180,
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(212,168,83,0.2) 0%, transparent 68%)',
              bottom: 40,
              left: -70,
              pointerEvents: 'none',
            }}
          />

          <div style={{ position: 'relative', zIndex: 1, padding: '16px 14px 28px' }}>
            {/* Hero card */}
            <div
              style={{
                position: 'relative',
                borderRadius: 16,
                padding: '18px 16px',
                background: 'linear-gradient(145deg, rgba(255,255,255,0.97) 0%, rgba(255,252,248,0.98) 100%)',
                border: '1px solid rgba(232,213,184,0.5)',
                boxShadow: '0 8px 32px rgba(44,24,16,0.08), 0 1px 0 rgba(255,255,255,0.9) inset',
              }}
            >
              <BannerPlatformCredit variant="onLight" />

              <div style={{ paddingRight: 'min(112px, 30vw)' }}>
                <h1 style={{
                  fontFamily: "'Noto Serif SC', serif",
                  fontSize: 22,
                  fontWeight: 700,
                  margin: 0,
                  padding: 0,
                  color: 'var(--text-dark)',
                  lineHeight: 1.25,
                  width: '100%',
                  ...(lang.startsWith('zh')
                    ? { wordBreak: 'keep-all' as const }
                    : { overflowWrap: 'break-word' as const }),
                }}>
                  {storeTitle}
                </h1>
                {displayNameOther ? (
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.45 }}>{displayNameOther}</div>
                ) : null}
              </div>

              <div style={{ paddingRight: 'min(112px, 30vw)', marginTop: 14 }}>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)', letterSpacing: 0.02 }}>
                  {t('customer.storePortalTagline')}
                </p>
                <div style={{ marginTop: 10 }}>
                  {hoursLoading ? (
                    <span style={{
                      display: 'inline-block',
                      fontSize: 11,
                      fontWeight: 600,
                      padding: '4px 10px',
                      borderRadius: 20,
                      background: 'rgba(0,0,0,0.06)',
                      color: 'var(--text-secondary)',
                    }}>
                      {t('customer.storePortalCheckingHours')}
                    </span>
                  ) : (
                    <span style={{
                      display: 'inline-block',
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '4px 10px',
                      borderRadius: 20,
                      background: isOpen ? 'rgba(46,125,50,0.12)' : 'rgba(196,30,36,0.1)',
                      color: isOpen ? '#2E7D32' : 'var(--red-primary)',
                      border: `1px solid ${isOpen ? 'rgba(46,125,50,0.35)' : 'rgba(196,30,36,0.25)'}`,
                    }}>
                      {isOpen ? t('customer.storePortalOpenNow') : t('customer.storePortalClosedNow')}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Info grid */}
            {(slots.length > 0 || phone || address || email) && (
              <div style={{ marginTop: 14 }}>
                <div style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 0.06,
                  textTransform: 'uppercase',
                  color: 'var(--text-light)',
                  marginBottom: 10,
                }}>
                  {t('customer.storePortalAbout')}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {slots.length > 0 && (
                    <div style={infoCardStyle}>
                      <span style={{ fontSize: 18, lineHeight: 1 }} aria-hidden>🕐</span>
                      <div style={{ fontSize: 13, color: 'var(--text-dark)', lineHeight: 1.5 }}>
                        <span style={{ fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 2 }}>
                          {lang.startsWith('zh') ? '营业时间' : 'Hours'}
                        </span>
                        {slots.map((s, i) => (
                          <span key={i}>
                            {i > 0 && <span style={{ color: 'var(--text-light)' }}> · </span>}
                            {s.start}–{s.end}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {phone ? (
                    <a href={`tel:${phone.replace(/\s/g, '')}`} style={{ ...infoCardStyle, textDecoration: 'none', color: 'inherit' }}>
                      <span style={{ fontSize: 18, lineHeight: 1 }} aria-hidden>📞</span>
                      <div>
                        <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 2 }}>
                          {lang.startsWith('zh') ? '电话' : 'Phone'}
                        </span>
                        <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--red-primary)' }}>{phone}</span>
                      </div>
                    </a>
                  ) : null}
                  {email ? (
                    <a href={`mailto:${email}`} style={{ ...infoCardStyle, textDecoration: 'none', color: 'inherit' }}>
                      <span style={{ fontSize: 18, lineHeight: 1 }} aria-hidden>✉️</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 2 }}>
                          {lang.startsWith('zh') ? '邮箱' : 'Email'}
                        </span>
                        <span style={{
                          fontWeight: 600,
                          fontSize: 14,
                          color: 'var(--blue, #1565c0)',
                          wordBreak: 'break-all' as const,
                        }}>
                          {email}
                        </span>
                      </div>
                    </a>
                  ) : null}
                  {address ? (
                    <div style={infoCardStyle}>
                      <span style={{ fontSize: 18, lineHeight: 1 }} aria-hidden>📍</span>
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <div style={{ fontSize: 13, color: 'var(--text-dark)', lineHeight: 1.5 }}>
                          <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 2 }}>
                            {lang.startsWith('zh') ? '地址' : 'Address'}
                          </span>
                          {mapHref ? (
                            <a href={mapHref} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--blue, #1565c0)', fontWeight: 600 }}>
                              {address}
                            </a>
                          ) : (
                            address
                          )}
                        </div>
                        {mapEmbedSrc ? (
                          <div
                            style={{
                              position: 'relative',
                              width: '100%',
                              height: 200,
                              borderRadius: 10,
                              overflow: 'hidden',
                              background: 'rgba(0,0,0,0.06)',
                              border: '1px solid rgba(232,213,184,0.45)',
                            }}
                          >
                            <iframe
                              title={t('customer.storePortalMapEmbedTitle')}
                              src={mapEmbedSrc}
                              loading="lazy"
                              referrerPolicy="no-referrer-when-downgrade"
                              style={{
                                border: 0,
                                display: 'block',
                                width: '100%',
                                height: '100%',
                              }}
                            />
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            )}

            {/* CTA */}
            <div style={{ marginTop: 20 }}>
              <div style={{
                fontSize: 13,
                fontWeight: 700,
                color: 'var(--text-dark)',
                marginBottom: 12,
                fontFamily: "'Noto Serif SC', serif",
              }}>
                {t('customer.storePortalChooseTitle')}
              </div>
              {canMemberPortal ? (
                <div style={{ textAlign: 'center', marginBottom: 10 }}>
                  <Link to={`/${storeSlug}/customer/member`} style={{ fontSize: 13, color: 'var(--blue, #1565c0)', fontWeight: 600 }}>
                    {t('member.title')}
                  </Link>
                </div>
              ) : null}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {canDelivery ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!isOpen || hoursLoading}
                    onClick={() => setMode('delivery')}
                    style={{
                      width: '100%',
                      padding: '14px 16px',
                      fontSize: 16,
                      fontWeight: 700,
                      borderRadius: 14,
                      textAlign: 'left',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'stretch',
                      gap: 4,
                      boxShadow: '0 6px 20px rgba(196,30,36,0.22)',
                    }}
                  >
                    <span>🚚 {lang.startsWith('zh') ? '外卖送餐' : 'Delivery'}</span>
                    <span style={{ fontSize: 12, fontWeight: 500, opacity: 0.92 }}>{t('customer.storePortalDeliveryHint')}</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  className={canDelivery ? 'btn btn-outline' : 'btn btn-primary'}
                  disabled={!isOpen || hoursLoading}
                  onClick={() => setMode('takeout')}
                  style={{
                    width: '100%',
                    padding: '14px 16px',
                    fontSize: 16,
                    fontWeight: 700,
                    borderRadius: 14,
                    borderWidth: canDelivery ? 2 : undefined,
                    borderColor: canDelivery ? 'rgba(74, 55, 40, 0.35)' : undefined,
                    textAlign: 'left',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'stretch',
                    gap: 4,
                    background: canDelivery ? 'var(--bg-white)' : undefined,
                    color: canDelivery ? 'var(--text-dark)' : undefined,
                    boxShadow: canDelivery ? '0 2px 10px rgba(44, 24, 16, 0.08)' : undefined,
                  }}
                >
                  <span style={{ color: canDelivery ? 'var(--text-dark)' : '#fff' }}>
                    🥡 {lang.startsWith('zh') ? '到店自取' : 'Pickup'}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      lineHeight: 1.4,
                      color: canDelivery ? 'var(--text-body)' : 'rgba(255,255,255,0.95)',
                    }}
                  >
                    {t('customer.storePortalPickupHint')}
                  </span>
                </button>
              </div>
              {!isOpen && !hoursLoading ? (
                <div style={{
                  marginTop: 14,
                  padding: '12px 14px',
                  borderRadius: 12,
                  background: 'rgba(196,30,36,0.06)',
                  border: '1px solid rgba(196,30,36,0.15)',
                  fontSize: 13,
                  color: 'var(--text-secondary)',
                  lineHeight: 1.45,
                }}>
                  {lang.startsWith('zh') ? '当前非营业时间，暂无法下单。' : 'Ordering is unavailable while closed.'}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {showMenu ? <MenuView storeFrontEmbed /> : null}
    </div>
  );
}
