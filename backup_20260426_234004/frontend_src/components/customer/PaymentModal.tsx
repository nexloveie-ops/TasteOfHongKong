import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { Elements, PaymentRequestButtonElement, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';

interface PaymentModalProps {
  orderId: string;
  amount: number;
  onSuccess: (checkoutId: string) => void;
  onClose: () => void;
}

let stripePromise: Promise<Stripe | null> | null = null;

function getStripePromise() {
  if (!stripePromise) {
    stripePromise = fetch('/api/payments/config')
      .then(r => r.json())
      .then(data => loadStripe(data.publishableKey));
  }
  return stripePromise;
}

function PaymentContent({ orderId, amount, onSuccess, onClose }: PaymentModalProps) {
  const { t } = useTranslation();
  const stripe = useStripe();
  const elements = useElements();
  const [clientSecret, setClientSecret] = useState('');
  const [paymentRequest, setPaymentRequest] = useState<ReturnType<Stripe['paymentRequest']> | null>(null);
  const [canPay, setCanPay] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // Create payment intent
  useEffect(() => {
    fetch('/api/payments/create-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.clientSecret) setClientSecret(data.clientSecret);
        else setError(data.error?.message || 'Failed');
      })
      .catch(() => setError(t('customer.paymentNetworkError')));
  }, [orderId, t]);

  // Setup Payment Request (Apple Pay / Google Pay)
  useEffect(() => {
    if (!stripe || !clientSecret) return;

    const pr = stripe.paymentRequest({
      country: 'IE',
      currency: 'eur',
      total: { label: 'Taste of Hong Kong', amount: Math.round(amount * 100) },
      requestPayerName: false,
      requestPayerEmail: false,
    });

    pr.canMakePayment().then(result => {
      if (result) {
        setPaymentRequest(pr);
        setCanPay(true);
      }
    });

    pr.on('paymentmethod', async (ev) => {
      setProcessing(true);
      const { error: confirmError, paymentIntent } = await stripe.confirmCardPayment(
        clientSecret,
        { payment_method: ev.paymentMethod.id },
        { handleActions: false }
      );

      if (confirmError) {
        ev.complete('fail');
        setError(confirmError.message || 'Payment failed');
        setProcessing(false);
      } else if (paymentIntent) {
        ev.complete('success');
        const res = await fetch('/api/payments/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId, paymentIntentId: paymentIntent.id }),
        });
        const data = await res.json();
        if (data.orderId || data.checkoutId) {
          setSuccess(true);
          setTimeout(() => onSuccess(data.orderId || data.checkoutId), 1000);
        }
        setProcessing(false);
      }
    });
  }, [stripe, clientSecret, amount, orderId, onSuccess]);

  // Card payment handler
  const handleCardPay = async () => {
    if (!stripe || !elements || !clientSecret) return;
    const cardElement = elements.getElement(CardElement);
    if (!cardElement) return;

    setProcessing(true);
    setError('');

    const { error: confirmError, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
      payment_method: { card: cardElement },
    });

    if (confirmError) {
      setError(confirmError.message || 'Payment failed');
      setProcessing(false);
      return;
    }

    if (paymentIntent?.status === 'succeeded') {
      const res = await fetch('/api/payments/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, paymentIntentId: paymentIntent.id }),
      });
      const data = await res.json();
      if (data.orderId || data.checkoutId) {
        setSuccess(true);
        setTimeout(() => onSuccess(data.orderId || data.checkoutId), 1000);
      }
    }
    setProcessing(false);
  };

  if (success) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#388E3C' }}>{t('customer.paymentSuccess')}</div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--red-primary)', fontFamily: "'Noto Serif SC', serif" }}>
          €{amount.toFixed(2)}
        </div>
      </div>

      {error && <div style={{ color: '#F44336', fontSize: 13, textAlign: 'center', marginBottom: 12 }}>{error}</div>}

      {/* Apple Pay / Google Pay button */}
      {canPay && paymentRequest && (
        <div style={{ marginBottom: 16 }}>
          <PaymentRequestButtonElement
            options={{ paymentRequest, style: { paymentRequestButton: { height: '48px' } } }}
          />
          <div style={{ textAlign: 'center', margin: '12px 0', fontSize: 12, color: 'var(--text-light)' }}>— or —</div>
        </div>
      )}

      {/* Card input */}
      {clientSecret && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ padding: '12px 14px', border: '1px solid #ddd', borderRadius: 8, background: '#fafafa' }}>
            <CardElement options={{
              style: {
                base: { fontSize: '16px', color: '#333', '::placeholder': { color: '#aab7c4' } },
                invalid: { color: '#F44336' },
              },
            }} />
          </div>
          <button onClick={handleCardPay} disabled={processing || !stripe}
            className="btn btn-primary"
            style={{ width: '100%', marginTop: 12, padding: '14px 0', fontSize: 15 }}>
            {processing ? t('customer.paymentProcessing') : `${t('customer.payNow')} €${amount.toFixed(2)}`}
          </button>
        </div>
      )}

      {processing && !clientSecret && (
        <div style={{ textAlign: 'center', padding: 12, color: 'var(--text-light)' }}>{t('customer.paymentProcessing')}</div>
      )}

      <div style={{ textAlign: 'center', marginTop: 8 }}>
        <button onClick={onClose} className="btn btn-outline" style={{ padding: '10px 24px' }}>
          {t('customer.payAtCounter')}
        </button>
      </div>
    </div>
  );
}

export default function PaymentModal({ orderId, amount, onSuccess, onClose }: PaymentModalProps) {
  const { t } = useTranslation();
  const [stripeLoaded, setStripeLoaded] = useState(false);
  const [stripeInstance, setStripeInstance] = useState<Promise<Stripe | null> | null>(null);

  useEffect(() => {
    const p = getStripePromise();
    setStripeInstance(p);
    p.then(() => setStripeLoaded(true));
  }, []);

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: '16px 16px 0 0',
        width: '100%', maxWidth: 430, padding: '24px 20px 32px',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>💳 {t('customer.payment')}</div>
        </div>

        {stripeLoaded && stripeInstance ? (
          <Elements stripe={stripeInstance}>
            <PaymentContent orderId={orderId} amount={amount} onSuccess={onSuccess} onClose={onClose} />
          </Elements>
        ) : (
          <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-light)' }}>{t('customer.paymentLoading')}</div>
        )}
      </div>
    </div>
  );
}
