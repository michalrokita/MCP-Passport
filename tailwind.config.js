/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Geist', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace']
      },
      colors: {
        ink: {
          50: '#f4f4f0',
          100: '#e8e8e3',
          200: '#d2d2cc',
          300: '#b6b6b0',
          400: '#8a8a84',
          500: '#6b6b66',
          600: '#4a4a47',
          700: '#2d2d2b',
          800: '#1f1f1d',
          850: '#161615',
          900: '#131312',
          950: '#0a0a0a'
        },
        accent: {
          DEFAULT: 'oklch(0.74 0.16 148)',
          soft: 'oklch(0.82 0.13 148)',
          deep: 'oklch(0.6 0.15 148)',
          glow: 'oklch(0.74 0.16 148 / 0.18)'
        }
      }
    }
  },
  plugins: []
}
