/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{html,ts}"],
  theme: {
    extend: {
      colors: {
        page: "#F7F8FA",
        card: "#FFFFFF",
        line: "#EAEBEE",
        muted: "#8A8F99",
        ink: "#14161A",
        highlight: {
          DEFAULT: "#D85A30",
          dim: "#A83F1F",
        },
        "team-primary": "var(--accent-primary, #3E7CB1)",
        "team-secondary": "var(--accent-secondary, #0B1220)",
      },
      fontFamily: {
        sans: ["Manrope", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 3px rgba(0,0,0,0.06)",
        pop: "0 4px 12px rgba(0,0,0,0.1)",
      },
    },
  },
  plugins: [],
};