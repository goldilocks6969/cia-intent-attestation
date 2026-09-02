/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      colors: {
        ink: "#070a12",
        panel: "#0d1220",
        line: "#1c2438",
        mint: "#34f5c5",
        amber: "#ffb454",
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(52,245,197,.25), 0 20px 80px -20px rgba(52,245,197,.35)",
      },
      keyframes: {
        pulseRing: {
          "0%": { transform: "scale(.9)", opacity: ".8" },
          "100%": { transform: "scale(1.6)", opacity: "0" },
        },
        shimmer: { "0%": { backgroundPosition: "0% 50%" }, "100%": { backgroundPosition: "200% 50%" } },
        fadeUp: { "0%": { opacity: 0, transform: "translateY(8px)" }, "100%": { opacity: 1, transform: "translateY(0)" } },
      },
      animation: {
        pulseRing: "pulseRing 1.6s ease-out infinite",
        shimmer: "shimmer 6s linear infinite",
        fadeUp: "fadeUp .35s ease-out both",
      },
    },
  },
  plugins: [],
};
