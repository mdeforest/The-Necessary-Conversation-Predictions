import { createContext, useContext } from 'react'

interface ThemeContextValue {
  isDark: boolean
  toggle: () => void
}

export const ThemeContext = createContext<ThemeContextValue>({ isDark: true, toggle: () => {} })

export function useThemeContext() {
  return useContext(ThemeContext)
}

/** Recharts tooltip style — changes with theme */
export function useTooltipStyle(isDark: boolean) {
  return {
    contentStyle: {
      backgroundColor: isDark ? '#162244' : '#ffffff',
      border: `1px solid ${isDark ? '#1E3A60' : '#e4e4e7'}`,
      borderRadius: '6px',
      color: isDark ? '#e2e8f0' : '#18181b',
    },
    labelStyle: { color: isDark ? '#93C5FD' : '#52525b' },
    itemStyle: { color: isDark ? '#e2e8f0' : '#1B2A5E' },
    cursor: { fill: isDark ? '#1E3A60' : '#f4f4f5' },
  }
}
