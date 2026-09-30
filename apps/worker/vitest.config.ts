import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: ['../../packages/db/test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 180_000,
    include: ['test/**/*.test.ts'],
  },
})
