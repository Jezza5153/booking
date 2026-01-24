/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./*.{ts,tsx}",
        "./components/**/*.{ts,tsx}",
        "./src/**/*.{ts,tsx}",
    ],
    theme: {
        extend: {
            keyframes: {
                shimmer: {
                    '0%': { transform: 'translateX(-150%)' },
                    '100%': { transform: 'translateX(150%)' },
                }
            }
        },
    },
    plugins: [],
}
