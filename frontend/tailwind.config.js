/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{html,ts}"],
  theme: {
    extend: {
      colors: {
        // Backed by CSS variables (set in styles.css, dark values by
        // default, overridden under [data-theme="light"]) so every existing
        // bg-page/bg-card/border-line/text-muted/text-ink usage across the
        // app repaints for the theme toggle with zero template changes.
        // highlight stays a fixed brand color on purpose — it shouldn't
        // shift between themes.
        page: "var(--color-page, #0A0A0B)",
        card: "var(--color-card, #151516)",
        line: "var(--color-line, #232324)",
        muted: "var(--color-muted, #8A8A86)",
        ink: "var(--color-ink, #F0F0EC)",
        highlight: {
          DEFAULT: "#FF6B35",
          dim: "#C94A24",
        },
        // Second accent, distinct from highlight — used for rank/position
        // emphasis (e.g. a #1 standings chip) so that signal reads as
        // separate from the points/stats emphasis highlight already owns.
        accent2: {
          DEFAULT: "#7C6CF0",
          dim: "#5B48D9",
        },
        "team-primary": "var(--accent-primary, #3E7CB1)",
        "team-secondary": "var(--accent-secondary, #0B1220)",
      },
      fontFamily: {
        // Greek-verified trio (see styles.css) — Rajdhani/Barlow/JetBrains
        // Mono had no Greek glyphs at all.
        sans: ["Roboto Condensed", "system-ui", "sans-serif"],
        display: ["Play", "Arial", "sans-serif"],
        mono: ["Fira Code", "ui-monospace", "monospace"],
      },
      boxShadow: {
        // Real elevation instead of a near-flat 1px line — was previously
        // indistinguishable from a plain bordered box on the near-black page.
        card: "0 8px 24px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)",
        pop: "0 4px 16px rgba(0,0,0,0.5)",
      },
    },
  },
  plugins: [],
};