import react from '@vitejs/plugin-react'
import { defineConfig, type UserConfig } from 'vite'
import type { InlineConfig as VitestInlineConfig } from 'vitest/node'

// Vitest's own `defineConfig` is typed against the copy of Vite it bundles,
// which clashes with the workspace Vite's plugin types, so the `test` block is
// typed explicitly instead of via `/// <reference types="vitest/config" />`.
const config: UserConfig & { test: VitestInlineConfig } = {
  plugins: [react()],
  // Relative base so the built site works from any sub-path (e.g. GitHub Pages).
  base: './',
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
  },
}

// https://vite.dev/config/
export default defineConfig(config)
