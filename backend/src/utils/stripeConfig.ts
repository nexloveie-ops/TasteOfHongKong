import Stripe from 'stripe';
import { SystemConfig } from '../models/SystemConfig';
import { createAppError } from '../middleware/errorHandler';

export const STRIPE_PUBLISHABLE_CONFIG_KEY = 'stripe_publishable_key';
export const STRIPE_SECRET_CONFIG_KEY = 'stripe_secret_key';

/** Keys never exposed on public GET /api/admin/config */
export const STRIPE_KEYS_FILTER_FROM_PUBLIC_CONFIG = new Set([
  STRIPE_SECRET_CONFIG_KEY,
  STRIPE_PUBLISHABLE_CONFIG_KEY,
]);

/** Payment /customer Stripe.js — database only (system_configs.stripe_publishable_key). */
export async function getStripePublishableResolved(): Promise<string> {
  const row = await SystemConfig.findOne({ key: STRIPE_PUBLISHABLE_CONFIG_KEY }).lean();
  return row?.value?.trim() || '';
}

/** Server Stripe SDK — database only (system_configs.stripe_secret_key). */
export async function getStripeSecretResolved(): Promise<string> {
  const row = await SystemConfig.findOne({ key: STRIPE_SECRET_CONFIG_KEY }).lean();
  return row?.value?.trim() || '';
}

/** Same as publishable resolved — kept for admin GET wording / symmetry */
export async function getStripePublishableFromDbOnly(): Promise<string> {
  return getStripePublishableResolved();
}

export async function hasStripeSecretInDb(): Promise<boolean> {
  const row = await SystemConfig.findOne({ key: STRIPE_SECRET_CONFIG_KEY }).lean();
  return !!row?.value?.trim();
}

export async function createStripeClient() {
  const secret = await getStripeSecretResolved();
  if (!secret) {
    throw createAppError(
      'VALIDATION_ERROR',
      'Stripe secret key is not configured in the database. Save keys under Admin → Stripe.',
    );
  }
  return new Stripe(secret);
}

export type StripeKeyMode = 'test' | 'live' | 'unknown';

/** True if key looks like pk_test_* / pk_live_* */
export function isValidPublishableKeyFormat(pk: string): boolean {
  return /^pk_(test|live)_/.test(pk.trim());
}

/** True if key looks like sk_test_* / sk_live_* */
export function isValidSecretKeyFormat(sk: string): boolean {
  return /^sk_(test|live)_/.test(sk.trim());
}

export function stripeKeyMode(key: string): StripeKeyMode {
  const k = key.trim();
  if (k.startsWith('pk_test_') || k.startsWith('sk_test_')) return 'test';
  if (k.startsWith('pk_live_') || k.startsWith('sk_live_')) return 'live';
  return 'unknown';
}

export type StripeHealthApiResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

export type StripeHealthResult = {
  ok: boolean;
  checks: {
    publishableKeyPresent: boolean;
    publishableKeyFormatOk: boolean;
    publishableMode: StripeKeyMode;
    hasSecret: boolean;
    secretKeyFormatOk: boolean;
    secretMode: StripeKeyMode | 'absent';
    modeMatch: boolean;
  };
  stripeApi: StripeHealthApiResult;
};

/**
 * Read-only checks: key shapes, test/live alignment, and a live Stripe.balance.retrieve()
 * to verify the secret key works (no charges, no PaymentIntent created).
 */
export async function runStripeHealthCheck(): Promise<StripeHealthResult> {
  const publishableKey = await getStripePublishableResolved();
  const secret = await getStripeSecretResolved();

  const publishableKeyPresent = !!publishableKey;
  const publishableKeyFormatOk = publishableKeyPresent && isValidPublishableKeyFormat(publishableKey);
  const publishableMode = publishableKey ? stripeKeyMode(publishableKey) : 'unknown';

  const hasSecret = !!secret;
  const secretKeyFormatOk = hasSecret && isValidSecretKeyFormat(secret);
  const secretMode: StripeHealthResult['checks']['secretMode'] = hasSecret ? stripeKeyMode(secret) : 'absent';

  let modeMatch = true;
  if (publishableKeyFormatOk && secretKeyFormatOk && publishableMode !== 'unknown' && secretMode !== 'unknown') {
    modeMatch = publishableMode === secretMode;
  }

  let stripeApi: StripeHealthApiResult;
  if (!hasSecret) {
    stripeApi = {
      ok: false,
      code: 'NO_SECRET',
      message: 'Stripe secret key is not saved in the database.',
    };
  } else if (!secretKeyFormatOk) {
    stripeApi = {
      ok: false,
      code: 'INVALID_SECRET_FORMAT',
      message: 'Secret key must start with sk_test_ or sk_live_.',
    };
  } else {
    try {
      const stripe = new Stripe(secret);
      await stripe.balance.retrieve();
      stripeApi = { ok: true };
    } catch (err: unknown) {
      const e = err as { type?: string; code?: string; message?: string; raw?: { message?: string } };
      stripeApi = {
        ok: false,
        code: String(e.code || e.type || 'STRIPE_ERROR'),
        message: e.message || e.raw?.message || 'Stripe API request failed',
      };
    }
  }

  const ok =
    publishableKeyFormatOk &&
    hasSecret &&
    secretKeyFormatOk &&
    modeMatch &&
    stripeApi.ok;

  return {
    ok,
    checks: {
      publishableKeyPresent,
      publishableKeyFormatOk,
      publishableMode,
      hasSecret,
      secretKeyFormatOk: hasSecret ? secretKeyFormatOk : false,
      secretMode,
      modeMatch,
    },
    stripeApi,
  };
}
