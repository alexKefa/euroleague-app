// Theme colors are CSS variables holding hex values, which Tailwind can't
// apply an opacity modifier to on its own — so `bg-team-primary/10`,
// `bg-card/80`, `border-line/60` etc. used to generate no CSS at all and
// silently rendered nothing (found 2026-09-29: 180 such usages app-wide).
// A color function lets Tailwind build them with color-mix() instead.
const themeVar = (name, fallback) => ({ opacityValue }) =>
  // Plain `bg-card` passes Tailwind's own `var(--tw-bg-opacity, 1)` here —
  // keep that a plain var() so a browser without color-mix() still gets
  // every solid color; only an explicit `/NN` modifier uses color-mix().
  opacityValue === undefined || opacityValue === "1" || String(opacityValue).startsWith("var(")
    ? `var(${name}, ${fallback})`
    : `color-mix(in srgb, var(${name}, ${fallback}) calc(${opacityValue} * 100%), transparent)`;

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
        page: themeVar("--color-page", "#0A0A0B"),
        card: themeVar("--color-card", "#151516"),
        line: themeVar("--color-line", "#232324"),
        muted: themeVar("--color-muted", "#8A8A86"),
        ink: themeVar("--color-ink", "#F0F0EC"),
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
        // Fallback matches styles.css's :root default / ThemeService's
        // DEFAULT_PRIMARY (the "no favorite team yet" brand orange) — kept
        // in sync even though --accent-primary is always defined there in
        // practice, so this var() fallback never actually triggers.
        "team-primary": themeVar("--accent-primary", "#FF6B35"),
        "team-secondary": themeVar("--accent-secondary", "#0B1220"),
      },
      fontFamily: {
        // 2026-10-07: Sofia Sans for text, Sofia Sans Condensed for display
        // (headings, scores). "mono" is the small data/meta-label role: same
        // text face, with tabular numbers (styles.css .font-mono).
        sans: ["Sofia Sans", "system-ui", "sans-serif"],
        display: ["Sofia Sans Condensed", "Sofia Sans", "system-ui", "sans-serif"],
        mono: ["Sofia Sans", "system-ui", "sans-serif"],
      },
      // Weight system (2026-10-07): 400 body, 600 labels/buttons, 800 display
      // (.font-display). font-bold was on ~790 elements, so everything read
      // heavy; mapping it to 600 fixes that without touching every template.
      // Use font-extrabold (800) for the rare non-display element that
      // genuinely needs to shout.
      fontWeight: {
        bold: "600",
      },
      boxShadow: {
        // Real elevation instead of a near-flat 1px line — was previously
        // indistinguishable from a plain bordered box on the near-black page.
        card: "0 8px 24px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)",
        pop: "0 4px 16px rgba(0,0,0,0.5)",
        // Mobile bottom nav's "lift & glow" active tab (app.component.html)
        // — a ring matching the nav's own background (so the lifted icon
        // reads as a cutout bubble rather than a flat circle) plus a
        // highlight-colored halo bleeding out behind it. The ring uses the
        // theme-reactive card token; the glow color is fixed (highlight
        // itself never shifts between themes either).
        navLift: "0 0 0 6px var(--color-card, #151516), 0 6px 16px rgba(255,107,53,0.45)",
      },
    },
  },
  plugins: [],
};