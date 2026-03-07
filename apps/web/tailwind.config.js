/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: '#1F2A44',
          50: '#f0f3f9',
          100: '#d9e1f0',
          200: '#b3c3e1',
          300: '#8da5d2',
          400: '#6787c3',
          500: '#4169b4',
          600: '#3E5C76',
          700: '#1F2A44',
          800: '#162033',
          900: '#0e1522',
        },
        steel: '#3E5C76',
        slate: '#748CAB',
        status: {
          draft: '#94A3B8',
          review: '#ED6C02',
          approved: '#0288D1',
          released: '#2E7D32',
          superseded: '#334155',
          obsolete: '#C62828',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      }
    },
  },
  plugins: [],
}
