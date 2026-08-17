import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@pf-worksurface/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@pf-worksurface/cli': fileURLToPath(new URL('./packages/cli/src/index.ts', import.meta.url)),
      '@pf-worksurface/dsh': fileURLToPath(new URL('./packages/dsh/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/*/tests/**/*.spec.ts'],
    pool: 'forks',
  },
})
