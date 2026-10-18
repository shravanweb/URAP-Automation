// URAP design tokens. The palette is deliberately small: a navy ink, cool neutrals, and one
// orange accent. `ember` is the accessible button orange (white text passes WCAG AA, 4.7:1);
// `brand` is the brighter logo / highlight orange. Legacy names (cream, sand, ink, ...) are kept
// so every existing page picks up the new look without per-page changes.
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'media',
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      white: '#FFFFFF',
      black: '#0B1418',
      // neutrals (legacy names)
      cream: '#F5F7F9',
      cream2: '#EDF0F3',
      sand: '#D9DEE3',
      mist: '#F8FAFB',
      line: '#E3E7EB',
      muted: '#5F6B72',
      charcoal: '#2A363C',
      ink: '#172125',
      // light home surfaces (Automation Cloud home)
      canvas: '#FAF9F7',
      hairline: '#ECE8E3',
      // accent
      brand: '#FA4616',
      brandsoft: '#FFF1EC',
      ember: '#D63A0C',
      emberdark: '#B8320A',
      emberdeep: '#962808',
      // navy surfaces
      navy: { 700: '#1E2B31', 800: '#172125', 900: '#0F171B', 950: '#0B1216' },
      slate: {
        50: '#F8FAFB', 100: '#F1F4F6', 200: '#E3E7EB', 300: '#CBD2D8', 400: '#9AA5AD',
        500: '#6B7780', 600: '#4F5B63', 700: '#36434A', 800: '#232E34', 900: '#172125',
      },
      teal: '#1AA7AD',
      success: '#2F6B45',
      danger: '#B42318',
      warning: '#9A5B0B',
    },
    fontFamily: {
      sans: ['Inter', 'Segoe UI', 'system-ui', '-apple-system', 'sans-serif'],
      mono: ['ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
    },
    extend: {
      boxShadow: {
        card: '0 1px 2px rgba(15, 23, 27, 0.06), 0 1px 3px rgba(15, 23, 27, 0.08)',
        lift: '0 12px 32px -8px rgba(15, 23, 27, 0.18)',
        glow: '0 24px 64px -16px rgba(250, 70, 22, 0.35)',
      },
      maxWidth: { page: '76rem' },
      keyframes: {
        'launcher-in': { '0%': { opacity: '0', transform: 'translateY(-4px) scale(0.98)' }, '100%': { opacity: '1', transform: 'none' } },
      },
      animation: { 'launcher-in': 'launcher-in 140ms cubic-bezier(0.2, 0.8, 0.2, 1)' },
    },
  },
  plugins: [],
};
