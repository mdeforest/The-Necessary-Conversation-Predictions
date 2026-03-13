import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Verdict colors
        verdict: {
          true: '#22c55e',
          'partially true': '#84cc16',
          false: '#ef4444',
          pending: '#f59e0b',
          unverifiable: '#6b7280',
        },
        // US political accent colors
        navy: '#1B2A5E',
        patriot: '#B22234',
        // Speaker colors
        chad: '#3b82f6',
        haley: '#a855f7',
        mary: '#f97316',
        bob: '#14b8a6',
      },
    },
  },
  plugins: [],
} satisfies Config
