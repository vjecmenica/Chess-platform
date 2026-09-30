import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/server/test/**/*.integration.test.ts'],
    // The integration files share one database and some inject controlled wall clocks.
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
