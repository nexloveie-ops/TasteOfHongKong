import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { parseQRParams } from '../../utils/qrCode';

export default function ScanLanding() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation();
  const params = parseQRParams(searchParams);

  useEffect(() => {
    if (params.type === 'dine_in') {
      navigate(`/customer/menu?table=${params.tableNumber}&seat=${params.seatNumber}`, { replace: true });
    } else if (params.type === 'takeout') {
      navigate('/customer/menu?type=takeout', { replace: true });
    }
  }, [params, navigate]);

  if (params.type === 'invalid') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '80vh', padding: 20, textAlign: 'center' }}>
        {/* Hero branding */}
        <div style={{
          background: 'linear-gradient(135deg, #8B1A1A 0%, #C41E24 50%, #D4342A 100%)',
          borderRadius: 16, padding: '40px 32px', marginBottom: 24, width: '100%', maxWidth: 340,
          color: '#fff', position: 'relative', overflow: 'hidden',
        }}>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <h1 style={{ fontFamily: "'Noto Serif SC', serif", fontSize: 26, fontWeight: 700, letterSpacing: 3, marginBottom: 4 }}>
              港知味
            </h1>
            <div style={{ fontSize: 12, fontWeight: 300, letterSpacing: 6, color: '#F0D68A', textTransform: 'uppercase' }}>
              TASTE OF HONG KONG
            </div>
            <div style={{
              display: 'inline-block', marginTop: 10, padding: '4px 14px',
              border: '1px solid #D4A853', color: '#F0D68A', fontSize: 11,
              letterSpacing: 2, borderRadius: 2,
            }}>港式燒臘 · 地道風味</div>
          </div>
        </div>

        <div style={{ fontSize: 48, marginBottom: 16 }}>📱</div>
        <p style={{ color: 'var(--text-light)', fontSize: 14, maxWidth: 280 }}>
          {t('customer.scanPrompt')}
        </p>
        <p style={{ color: 'var(--red-primary)', fontSize: 13, marginTop: 12 }}>
          {t('customer.invalidQR')}
        </p>
      </div>
    );
  }

  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>{t('common.loading')}</div>;
}
