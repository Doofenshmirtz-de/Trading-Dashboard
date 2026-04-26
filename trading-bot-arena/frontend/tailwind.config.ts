import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: { DEFAULT: '#0f172a' },
        text: { DEFAULT: '#f8fafc' },
        accent: { DEFAULT: '#3b82f6' },
      },
    },
  },
  plugins: [],
}

export default config
