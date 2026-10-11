import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@carbontwin/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url)
      ),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    // Keep test output clean: the suites deliberately trigger warn/error paths,
    // so suppress everything below `fatal` for the duration of the run.
    env: { LOG_LEVEL: 'fatal' },
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/ingestion/**/*.ts'],
      exclude: ['src/ingestion/tests/**', 'src/ingestion/**/*.d.ts'],
      thresholds: {
        lines: 70,
        functions: 70,
        statements: 70,
        branches: 60,
      },
    },
  },
});
