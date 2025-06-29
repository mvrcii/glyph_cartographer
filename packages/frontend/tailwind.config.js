// tailwind.config.js
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      keyframes: {
        'slide-in': {
          '0%': { transform: 'translateY(100%)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        // --- Add these new keyframes ---
        'slide-out': {
          '0%': { transform: 'translateY(0)', opacity: '1' },
          '100%': { transform: 'translateY(100%)', opacity: '0' },
        }
      },
      animation: {
        'slide-in': 'slide-in 0.3s ease-out forwards',
        // --- Add this new animation utility ---
        'slide-out': 'slide-out 0.3s ease-in forwards',
      }
    },
  },
  plugins: [],
}