/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background:    "var(--color-background)",
        card:          "var(--color-card)",
        "surface-2":   "var(--color-surface-2)",
        border:        "var(--color-border)",
        foreground:    "var(--color-foreground)",
        primary:       "var(--color-primary)",
        "btn-primary": "var(--color-btn-primary)",
        success:       "var(--color-success)",
        warning:       "var(--color-warning)",
        danger:        "var(--color-danger)",
        muted:         "var(--color-muted)",
        "input-bg":    "var(--color-input-bg)",
        "table-head":  "var(--color-table-head)",
        "gauge-track": "var(--color-gauge-track)",
      },
      fontFamily: {
        sans: ["Space Grotesk", "Segoe UI", "sans-serif"],
        mono: ["IBM Plex Mono", "Consolas", "monospace"]
      },
      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "-700px 0" },
          "100%": { backgroundPosition: "700px 0" }
        }
      },
      animation: {
        shimmer: "shimmer 1.8s linear infinite"
      }
    },
  },
  plugins: [],
}


