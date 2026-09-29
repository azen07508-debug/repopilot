import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * `globals: false` means React Testing Library cannot install its own
 * auto-cleanup, so unmounting is explicit here. Without it, a component from
 * one test stays mounted and the next test's `getByText` can match it.
 *
 * The language preference is persisted to `localStorage`, which survives
 * between tests in the same file; clearing it keeps each test's locale
 * deterministic.
 */
afterEach(() => {
  cleanup();
  try {
    localStorage.clear();
  } catch {
    // jsdom always provides localStorage; this is belt-and-braces.
  }
  document.documentElement.lang = 'en';
});
