/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        dark: {
          900: '#090D16',
          800: '#0F172A',
          700: '#1E293B',
          600: '#334155',
        },
        brand: {
          green: '#10B981',
          red: '#EF4444',
          yellow: '#F59E0B',
          cyan: '#06B6D4',
          purple: '#8B5CF6',
        }
      },
    },
  },
  plugins: [],
}
