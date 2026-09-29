import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/server/test/**/*.test.ts', 'apps/web/test/**/*.test.ts',
      'packages/domain/test/**/*.test.ts'],
    exclude: ['**/*.integration.test.ts'],
  },
});
