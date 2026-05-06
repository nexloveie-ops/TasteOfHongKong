import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { IllustrationBackoffice, IllustrationOrderFlow, IllustrationTenant } from './PortalIllustrations';

const portalStyles = `
@keyframes portal-grid-drift {
  0% { transform: perspective(500px) rotateX(60deg) translateY(0); }
  100% { transform: perspective(500px) rotateX(60deg) translateY(40px); }
}
@keyframes portal-float {
  0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.55; }
  50% { transform: translate(12px, -18px) scale(1.05); opacity: 0.85; }
}
@keyframes portal-float-2 {
  0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.4; }
  50% { transform: translate(-20px, 14px) scale(1.08); opacity: 0.75; }
}
@keyframes portal-pulse-line {
  0% { opacity: 0.15; transform: scaleX(0.3); }
  50% { opacity: 0.9; transform: scaleX(1); }
  100% { opacity: 0.15; transform: scaleX(0.3); }
}
@keyframes portal-shimmer {
  0% { background-position: 200% center; }
  100% { background-position: -200% center; }
}
@keyframes portal-fade-up {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes portal-scan {
  0% { transform: translateY(-100%); }
  100% { transform: translateY(100vh); }
}
.portal-root {
  min-height: 100vh;
  position: relative;
  overflow-x: hidden;
  background: #030712;
  color: #e2e8f0;
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
}
.portal-bg-grid {
  position: fixed;
  inset: -50%;
  background-image:
    linear-gradient(rgba(56, 189, 248, 0.07) 1px, transparent 1px),
    linear-gradient(90deg, rgba(56, 189, 248, 0.07) 1px, transparent 1px);
  background-size: 48px 48px;
  animation: portal-grid-drift 18s linear infinite;
  pointer-events: none;
  z-index: 0;
}
.portal-orb {
  position: fixed;
  border-radius: 50%;
  filter: blur(80px);
  pointer-events: none;
  z-index: 0;
}
.portal-orb-a {
  width: min(55vw, 420px);
  height: min(55vw, 420px);
  top: -8%;
  right: -5%;
  background: radial-gradient(circle, rgba(6, 182, 212, 0.45) 0%, transparent 70%);
  animation: portal-float 14s ease-in-out infinite;
}
.portal-orb-b {
  width: min(50vw, 380px);
  height: min(50vw, 380px);
  bottom: -5%;
  left: -10%;
  background: radial-gradient(circle, rgba(99, 102, 241, 0.4) 0%, transparent 70%);
  animation: portal-float-2 16s ease-in-out infinite;
}
.portal-orb-c {
  width: 280px;
  height: 280px;
  top: 40%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: radial-gradient(circle, rgba(236, 72, 153, 0.12) 0%, transparent 65%);
  animation: portal-float 20s ease-in-out infinite reverse;
}
.portal-scan {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 1;
  background: linear-gradient(
    transparent 0%,
    rgba(56, 189, 248, 0.03) 50%,
    transparent 100%
  );
  height: 120px;
  animation: portal-scan 10s linear infinite;
  opacity: 0.6;
}
.portal-header {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding: 20px 32px;
  border-bottom: 1px solid rgba(56, 189, 248, 0.15);
  backdrop-filter: blur(12px);
  background: rgba(3, 7, 18, 0.6);
}
.portal-brand {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.portal-logo {
  font-weight: 800;
  font-size: clamp(15px, 2.8vw, 20px);
  letter-spacing: 0.04em;
  line-height: 1.25;
  background: linear-gradient(105deg, #22d3ee 0%, #a78bfa 45%, #f472b6 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  background-size: 200% auto;
  animation: portal-shimmer 8s linear infinite;
}
.portal-tagline {
  font-size: 12px;
  color: rgba(148, 163, 184, 0.85);
  letter-spacing: 0.06em;
}
.portal-header-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.portal-lang {
  display: inline-flex;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.25);
  overflow: hidden;
  font-family: ui-sans-serif, system-ui, sans-serif;
}
.portal-lang button {
  margin: 0;
  padding: 8px 14px;
  font-size: 12px;
  font-weight: 600;
  border: none;
  cursor: pointer;
  background: transparent;
  color: rgba(148, 163, 184, 0.95);
  transition: background 0.2s, color 0.2s;
}
.portal-lang button:hover {
  color: #e2e8f0;
  background: rgba(56, 189, 248, 0.1);
}
.portal-lang button.portal-lang-active {
  background: rgba(34, 211, 238, 0.18);
  color: #22d3ee;
}
.portal-badge {
  font-size: 11px;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: rgba(34, 211, 238, 0.85);
  border: 1px solid rgba(34, 211, 238, 0.35);
  padding: 6px 12px;
  border-radius: 999px;
  font-family: ui-monospace, monospace;
}
.portal-main {
  position: relative;
  z-index: 2;
  max-width: 1080px;
  margin: 0 auto;
  padding: 56px 24px 72px;
}
.portal-lead2 {
  font-size: clamp(14px, 2vw, 16px);
  color: rgba(148, 163, 184, 0.88);
  max-width: 720px;
  margin: 20px auto 0;
  line-height: 1.75;
}
.portal-modules-head {
  text-align: center;
  margin-bottom: 28px;
  animation: portal-fade-up 0.85s ease-out both;
}
.portal-modules-head h2 {
  font-size: clamp(20px, 3vw, 26px);
  font-weight: 800;
  margin: 0 0 10px;
  color: #f1f5f9;
  letter-spacing: -0.02em;
}
.portal-modules-head p {
  margin: 0;
  font-size: 14px;
  color: #94a3b8;
  line-height: 1.65;
  max-width: 680px;
  margin-left: auto;
  margin-right: auto;
}
.portal-hero {
  text-align: center;
  margin-bottom: 48px;
  animation: portal-fade-up 0.9s ease-out both;
}
.portal-hero-line {
  height: 2px;
  width: min(320px, 80vw);
  margin: 0 auto 28px;
  background: linear-gradient(90deg, transparent, #22d3ee, #a78bfa, transparent);
  border-radius: 2px;
  animation: portal-pulse-line 4s ease-in-out infinite;
  box-shadow: 0 0 20px rgba(34, 211, 238, 0.5);
}
.portal-h1 {
  font-size: clamp(28px, 5vw, 44px);
  font-weight: 800;
  line-height: 1.15;
  margin: 0 0 20px;
  letter-spacing: -0.02em;
  background: linear-gradient(135deg, #f8fafc 0%, #cbd5e1 40%, #22d3ee 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.portal-lead {
  font-size: clamp(15px, 2.2vw, 18px);
  color: rgba(148, 163, 184, 0.95);
  max-width: 640px;
  margin: 0 auto;
  line-height: 1.75;
}
.portal-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 20px;
}
.portal-card {
  position: relative;
  padding: 24px;
  border-radius: 16px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  background: linear-gradient(145deg, rgba(15, 23, 42, 0.85) 0%, rgba(15, 23, 42, 0.4) 100%);
  backdrop-filter: blur(16px);
  box-shadow:
    0 0 0 1px rgba(34, 211, 238, 0.05) inset,
    0 20px 50px -20px rgba(0, 0, 0, 0.5);
  transition: transform 0.35s ease, border-color 0.35s ease, box-shadow 0.35s ease;
  animation: portal-fade-up 0.8s ease-out both;
}
.portal-card:nth-child(1) { animation-delay: 0.1s; }
.portal-card:nth-child(2) { animation-delay: 0.2s; }
.portal-card:nth-child(3) { animation-delay: 0.3s; }
.portal-card:nth-child(4) { animation-delay: 0.4s; }
.portal-card:hover {
  transform: translateY(-4px);
  border-color: rgba(34, 211, 238, 0.35);
  box-shadow:
    0 0 0 1px rgba(34, 211, 238, 0.12) inset,
    0 24px 60px -16px rgba(34, 211, 238, 0.15);
}
.portal-card-glow {
  position: absolute;
  top: 0;
  left: 20px;
  right: 20px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(34, 211, 238, 0.6), transparent);
  opacity: 0.7;
  border-radius: 2px;
}
.portal-card h2 {
  font-size: 16px;
  font-weight: 700;
  margin: 8px 0 12px;
  color: #f1f5f9;
  letter-spacing: 0.02em;
}
.portal-card p {
  margin: 0;
  font-size: 13px;
  color: rgba(148, 163, 184, 0.92);
  line-height: 1.7;
}
.portal-section {
  margin-top: 56px;
}
.portal-split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 36px;
  align-items: center;
  margin-bottom: 40px;
}
@media (max-width: 860px) {
  .portal-split {
    grid-template-columns: 1fr;
  }
  .portal-split--reverse .portal-split-visual {
    order: -1;
  }
}
.portal-split-text h3 {
  font-size: clamp(17px, 2.4vw, 20px);
  font-weight: 700;
  margin: 0 0 14px;
  color: #f1f5f9;
  line-height: 1.35;
}
.portal-split-text > p {
  margin: 0 0 14px;
  font-size: 14px;
  color: #94a3b8;
  line-height: 1.75;
}
.portal-bullet-list {
  margin: 0;
  padding-left: 18px;
  color: #94a3b8;
  font-size: 13px;
  line-height: 1.7;
}
.portal-bullet-list li {
  margin-bottom: 8px;
}
.portal-split-visual {
  border-radius: 16px;
  border: 1px solid rgba(56, 189, 248, 0.22);
  background: linear-gradient(165deg, rgba(15, 23, 42, 0.85) 0%, rgba(15, 23, 42, 0.45) 100%);
  padding: 18px 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  box-shadow: 0 16px 48px -24px rgba(0, 0, 0, 0.55);
}
.portal-card-idx {
  font-family: ui-monospace, monospace;
  font-size: 11px;
  color: rgba(34, 211, 238, 0.75);
  letter-spacing: 0.12em;
}
.portal-footer {
  margin-top: 64px;
  padding-top: 28px;
  border-top: 1px solid rgba(51, 65, 85, 0.5);
  text-align: center;
  font-size: 12px;
  color: rgba(100, 116, 139, 0.9);
  letter-spacing: 0.06em;
  line-height: 1.5;
  animation: portal-fade-up 1s ease-out 0.5s both;
}
`;

const CARD_KEYS = ['dineIn', 'takeaway', 'counter', 'menu'] as const;

export default function PortalHome() {
  const { t, i18n } = useTranslation();

  useEffect(() => {
    const lang = i18n.language?.startsWith('zh') ? 'zh-CN' : 'en';
    document.documentElement.lang = lang;
    document.title = `${t('portal.companyName')} — ${t('portal.tagline')}`;
  }, [i18n.language, t]);

  const setLanguage = (lng: string) => {
    void i18n.changeLanguage(lng);
    localStorage.setItem('language', lng);
  };

  return (
    <>
      <style>{portalStyles}</style>
      <div className="portal-root">
        <div className="portal-bg-grid" aria-hidden />
        <div className="portal-orb portal-orb-a" aria-hidden />
        <div className="portal-orb portal-orb-b" aria-hidden />
        <div className="portal-orb portal-orb-c" aria-hidden />
        <div className="portal-scan" aria-hidden />

        <header className="portal-header">
          <div className="portal-brand">
            <div className="portal-logo">{t('portal.companyName')}</div>
            <div className="portal-tagline">{t('portal.tagline')}</div>
          </div>
          <div className="portal-header-right">
            <div className="portal-lang" role="group" aria-label={t('common.language')}>
              <button
                type="button"
                className={i18n.language?.startsWith('en') ? 'portal-lang-active' : ''}
                onClick={() => setLanguage('en-US')}
              >
                {t('portal.langEn')}
              </button>
              <button
                type="button"
                className={i18n.language?.startsWith('zh') ? 'portal-lang-active' : ''}
                onClick={() => setLanguage('zh-CN')}
              >
                {t('portal.langZh')}
              </button>
            </div>
            <span className="portal-badge">{t('portal.badge')}</span>
          </div>
        </header>

        <main className="portal-main">
          <section className="portal-hero">
            <div className="portal-hero-line" />
            <h1 className="portal-h1">{t('portal.hero')}</h1>
            <p className="portal-lead">{t('portal.lead')}</p>
            <p className="portal-lead2">{t('portal.lead2')}</p>
          </section>

          <div className="portal-modules-head">
            <h2>{t('portal.modulesTitle')}</h2>
            <p>{t('portal.modulesSubtitle')}</p>
          </div>

          <div className="portal-cards">
            {CARD_KEYS.map((key, i) => (
              <article key={key} className="portal-card">
                <div className="portal-card-glow" />
                <div className="portal-card-idx">
                  {String(i + 1).padStart(2, '0')} · {t('portal.moduleLabel')}
                </div>
                <h2>{t(`portal.cards.${key}.title`)}</h2>
                <p>{t(`portal.cards.${key}.desc`)}</p>
              </article>
            ))}
          </div>

          <section className="portal-section" aria-labelledby="portal-chain-heading">
            <div className="portal-split">
              <div className="portal-split-text">
                <h3 id="portal-chain-heading">{t('portal.chainSplit.title')}</h3>
                <p>{t('portal.chainSplit.body')}</p>
                <ul className="portal-bullet-list">
                  <li>{t('portal.chainSplit.b1')}</li>
                  <li>{t('portal.chainSplit.b2')}</li>
                  <li>{t('portal.chainSplit.b3')}</li>
                </ul>
              </div>
              <div className="portal-split-visual">
                <IllustrationTenant
                  labels={{
                    platform: t('portal.illus.chainHub'),
                    storeA: t('portal.illus.storeA'),
                    storeB: t('portal.illus.storeB'),
                    storeC: t('portal.illus.storeC'),
                  }}
                />
              </div>
            </div>

            <div className="portal-split portal-split--reverse">
              <div className="portal-split-visual">
                <IllustrationOrderFlow
                  labels={{
                    scan: t('portal.illus.flowPick'),
                    cart: t('portal.illus.flowCart'),
                    pay: t('portal.illus.flowPay'),
                    track: t('portal.illus.flowPickup'),
                  }}
                />
              </div>
              <div className="portal-split-text">
                <h3>{t('portal.flowSplit.title')}</h3>
                <p>{t('portal.flowSplit.body')}</p>
                <ul className="portal-bullet-list">
                  <li>{t('portal.flowSplit.b1')}</li>
                  <li>{t('portal.flowSplit.b2')}</li>
                </ul>
              </div>
            </div>

            <div className="portal-split">
              <div className="portal-split-text">
                <h3>{t('portal.opsSplit.title')}</h3>
                <p>{t('portal.opsSplit.body')}</p>
                <ul className="portal-bullet-list">
                  <li>{t('portal.opsSplit.b1')}</li>
                  <li>{t('portal.opsSplit.b2')}</li>
                </ul>
              </div>
              <div className="portal-split-visual">
                <IllustrationBackoffice
                  labels={{
                    menu: t('portal.illus.dashMenu'),
                    orders: t('portal.illus.dashOrders'),
                    reports: t('portal.illus.dashReports'),
                  }}
                />
              </div>
            </div>
          </section>

          <footer className="portal-footer">{t('portal.footer')}</footer>
        </main>
      </div>
    </>
  );
}
