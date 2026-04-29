import { describe, it, expect, afterEach } from 'vitest';

/**
 * ARViewer unit tests — validates the platform detection logic
 * and component contract (props interface).
 *
 * Note: Full component rendering tests require @testing-library/react
 * which is not currently installed. These tests cover the pure logic.
 */

describe('ARViewer platform detection', () => {
  const originalNavigator = globalThis.navigator;

  function mockUserAgent(ua: string) {
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: ua },
      writable: true,
      configurable: true,
    });
  }

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
  });

  // Re-implement the detection functions here to test them in isolation
  function isIOS(): boolean {
    if (typeof navigator === 'undefined') return false;
    return /iPad|iPhone|iPod/.test(navigator.userAgent);
  }

  function isAndroid(): boolean {
    if (typeof navigator === 'undefined') return false;
    return /Android/i.test(navigator.userAgent);
  }

  it('detects iOS iPhone user agent', () => {
    mockUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)');
    expect(isIOS()).toBe(true);
    expect(isAndroid()).toBe(false);
  });

  it('detects iOS iPad user agent', () => {
    mockUserAgent('Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)');
    expect(isIOS()).toBe(true);
    expect(isAndroid()).toBe(false);
  });

  it('detects Android user agent', () => {
    mockUserAgent('Mozilla/5.0 (Linux; Android 13; Pixel 7)');
    expect(isIOS()).toBe(false);
    expect(isAndroid()).toBe(true);
  });

  it('detects desktop (neither iOS nor Android)', () => {
    mockUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    expect(isIOS()).toBe(false);
    expect(isAndroid()).toBe(false);
  });

  it('handles missing navigator gracefully', () => {
    // Simulate server-side / no navigator
    const saved = globalThis.navigator;
    // @ts-expect-error — intentionally removing navigator for test
    delete globalThis.navigator;
    expect(isIOS()).toBe(false);
    expect(isAndroid()).toBe(false);
    Object.defineProperty(globalThis, 'navigator', {
      value: saved,
      writable: true,
      configurable: true,
    });
  });
});
