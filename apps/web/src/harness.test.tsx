/**
 * Proves the harness itself works before any product assertion is trusted.
 *
 * The lesson this file encodes: a suite that passes because the fake server
 * never received a request, or because `Response` was undefined and every
 * promise rejected into a caught-and-ignored path, looks exactly like a suite
 * that passes because the product is correct. So the harness gets its own
 * assertions, and they are about the instrument, not the app.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { render } from '@testing-library/react';
import { App } from './App.js';
import { installFakeApi } from './test/fake-api.js';
import { makeReport } from './test/fixtures.js';

let api: ReturnType<typeof installFakeApi> | null = null;

afterEach(() => {
  api?.restore();
  api = null;
});

describe('test harness', () => {
  it('runs in a real DOM with a working Response implementation', async () => {
    expect(typeof document).toBe('object');
    expect(document.body).toBeTruthy();

    // `lib/api.ts` calls `r.json()` on what fetch returns. If Response were
    // missing, every test would fail for a reason unrelated to the app.
    const r = new Response(JSON.stringify({ ok: true }), { status: 202 });
    expect(r.ok).toBe(true);
    expect(await r.json()).toEqual({ ok: true });

    // 402 must be constructible and `ok: false` — the whole challenge flow
    // depends on that pairing.
    const denied = new Response('{}', { status: 402 });
    expect(denied.ok).toBe(false);
    expect(denied.status).toBe(402);
  });

  it('installs a fetch stub that actually receives the app\'s requests', async () => {
    api = installFakeApi({ jobStates: ['completed'], report: makeReport() });
    render(<App />);

    // The app calls /health and /api/v1/capabilities on mount. If the stub
    // were not installed, these would hit the real network and hang.
    await waitFor(() => {
      expect(api!.requests.length).toBeGreaterThan(0);
    });
    const paths = api.requests.map((r) => r.path);
    expect(paths).toContain('/health');
    expect(paths).toContain('/api/v1/capabilities');

    // And the app really rendered, so a passing assertion below means
    // something.
    expect(await screen.findByText(/No report yet/i)).toBeTruthy();
  });
});
