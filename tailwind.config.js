/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'SF Pro Display',
          'Inter',
          'system-ui',
          'sans-serif'
        ],
        mono: ['SF Mono', 'JetBrains Mono', 'ui-monospace', 'monospace']
      },
      colors: {
        ink: {
          50: '#f8f8f7',
          100: '#efeeec',
          200: '#dfdedb',
          300: '#bfbcb6',
          400: '#9b9890',
          500: '#777570',
          600: '#54534f',
          700: '#3a3937',
          800: '#262624',
          850: '#1d1d1c',
          900: '#161615',
          950: '#0e0e0d'
        },
        accent: {
          DEFAULT: '#c97f3a',
          soft: '#e9aa6f',
          deep: '#9c5e26'
        }
      }
    }
  },
  plugins: []
}
