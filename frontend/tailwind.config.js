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
        // Single dark-slate theme. Semantic accents: mint = approve/allow (emerald), red = blocked, amber = warning.
        ink: "#020617", // slate-950
        panel: "#0f172a", // slate-900
        line: "#1e293b", // slate-800
        mint: "#34d399", // emerald-400
        amber: "#fbbf24", // amber-400
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(52,211,153,.25), 0 20px 80px -20px rgba(52,211,153,.35)",
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
