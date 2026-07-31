/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{html,ts}"],
  theme: {
    extend: {
      colors: {
        ink: "#0B1220",
        panel: "#131B2E",
        hairline: "#232E45",
        muted: "#8792A6",
        amber: {
          DEFAULT: "#F5B92C",
          dim: "#BA7517",
        },
        "team-primary": "var(--accent-primary, #3E7CB1)",
        "team-secondary": "var(--accent-secondary, #0B1220)",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["Oswald", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
    },
  },
  plugins: [],
};