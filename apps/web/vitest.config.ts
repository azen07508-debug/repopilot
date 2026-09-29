import { defineConfig } from 'vitest/config';

/**
 * Tests for `apps/web` run in jsdom, because the thing under test is what a
 * user sees: the P0 this suite exists to prevent (`POST /api/v1/audits`
 * answers 202 and the UI silently dropped it) was invisible at the type
 * level and only observable in the DOM.
 *
 * `jsx: "react-jsx"` in tsconfig is enough for esbuild, so the React plugin
 * is not needed here.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'jsdom',
    testTimeout: 30_000,
    setupFiles: ['./src/test/setup.ts'],
  },
});
