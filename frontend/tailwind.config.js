/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{html,ts}"],
  theme: {
    extend: {
      colors: {
        page: "#0A0A0B",
        card: "#151516",
        line: "#232324",
        muted: "#8A8A86",
        ink: "#F0F0EC",
        highlight: {
          DEFAULT: "#FF6B35",
          dim: "#C94A24",
        },
        "team-primary": "var(--accent-primary, #3E7CB1)",
        "team-secondary": "var(--accent-secondary, #0B1220)",
      },
      fontFamily: {
        sans: ["Manrope", "system-ui", "sans-serif"],
        display: ["Bebas Neue", "Arial Narrow", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      boxShadow: {
        card: "0 1px 3px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.03)",
        pop: "0 4px 16px rgba(0,0,0,0.5)",
      },
    },
  },
  plugins: [],
};