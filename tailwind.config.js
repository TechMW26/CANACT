/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        candy: '#FAF8F2',
        surface: '#FFFFFF',
        ink: '#112822',
        muted: '#68736F',
        subtle: '#98A09D',
        line: '#E4E7E2',
        brand: { DEFAULT: '#1F6B55', dark: '#124638', light: '#DDEDE5' },
        red2: '#B64444',
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
