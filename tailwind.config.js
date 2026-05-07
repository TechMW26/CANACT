/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        candy: '#FFF8F8',
        surface: '#FFFFFF',
        ink: '#0A0A0A',
        muted: '#5C5C5C',
        subtle: '#9A9A9A',
        line: '#F0DCDC',
        brand: { DEFAULT: '#C8102E', dark: '#A00B23', light: '#FFD8DD' },
        red2: '#C8102E',
        orange2: '#E78B22',
        yellow2: '#E5C400',
        underground: '#1A1A1A',
      },
      boxShadow: {
        card: 'none',
      },
      borderRadius: { xl2: '1.25rem' },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
