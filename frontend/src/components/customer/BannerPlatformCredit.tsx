import { useTranslation } from 'react-i18next';

/** 点餐流程横幅右上角：L&Z Techserve LTD + 联系邮箱（与 i18n 文案一致） */
export default function BannerPlatformCredit({ variant = 'onGradient' }: { variant?: 'onGradient' | 'onLight' }) {
  const { t } = useTranslation();
  const email = t('portal.contactEmail');
  const onLight = variant === 'onLight';
  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        right: 12,
        zIndex: 20,
        textAlign: 'right',
        fontSize: 9,
        lineHeight: 1.45,
        maxWidth: 'min(220px, 48vw)',
        pointerEvents: 'auto',
        ...(onLight
          ? { color: 'var(--text-secondary)' }
          : { color: 'rgba(255,255,255,0.75)' }),
      }}
    >
      <div
        style={{
          fontWeight: 700,
          marginBottom: 2,
          color: onLight ? 'var(--text-dark)' : '#F0D68A',
        }}
      >
        {t('customer.footerCompany')}
      </div>
      <div>
        <a
          href={`mailto:${email}`}
          style={{
            color: onLight ? 'var(--blue, #1565c0)' : '#F0D68A',
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          {email}
        </a>
      </div>
    </div>
  );
}
