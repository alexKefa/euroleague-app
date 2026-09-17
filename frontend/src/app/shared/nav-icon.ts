import { Component, Input } from "@angular/core";

export type NavIconName =
  | "home"
  | "news"
  | "picks"
  | "store"
  | "user"
  | "wheel"
  | "packs"
  | "cards"
  | "trade"
  | "schedule"
  | "teams"
  | "standings"
  // Achievement/celebration set — replaces emoji (badges, page hints,
  // on-fire/double-double tags, the perfect-round banner). Same stroke
  // language as the nav icons above, not a separate visual system.
  | "trophy"
  | "flame"
  | "checkmark-shield"
  | "medal"
  | "sprout"
  | "zap"
  | "ball"
  | "tip"
  | "compass"
  | "logout"
  | "album"
  // install-banner.ts — the "add to home screen" nudge and its per-platform
  // instructions (iOS's Share icon, Android's overflow menu).
  | "install"
  | "share"
  | "dots-vertical"
  // Teams hub's top toolbar — the "full stats table" destination, distinct
  // from "standings" (ranked bars) since this one is a literal data grid.
  | "table"
  | "sliders"
  // Teams hub's top toolbar (the "Injury Report" destination) and the
  // roster/prediction badges for a player with an active report.
  | "injury"
  // Fantasy Five's on-court round-lock badge — replaces the 🔔 emoji used
  // there originally (see fantasy.html), same "no emoji, hand-drawn glyph"
  // convention as the achievement/celebration set above.
  | "bell"
  // Legendary Vote hub tile + page header — a ballot going into a box, so
  // it reads as "vote" specifically rather than reusing "trophy" (which
  // already means "an achievement you earned", the wrong signal for "cast
  // a vote").
  | "vote"
  // Favorite-player toggle — player-detail's hero and the roster table's
  // quick-favorite button (2026-09-13) share this one icon so both read as
  // the same action; `active` fills it solid, same convention as
  // home/cards/etc.
  | "star"
  // Leagues hub, dashboard's My Leagues tile, and landing's leagues
  // feature slide (2026-09-17) — a small bracket tree (two nodes
  // converging up to an apex) reads as "a private standings bracket among
  // a few people", the actual shape of what Leagues is. Two earlier
  // drafts were tried and reverted in the same pass: "friends" (two
  // overlapping heads) was nearly identical in silhouette to "teams"
  // (also two player heads, "browse rosters") at nav-icon size; a literal
  // "handshake" (two arms + a clasped-fist diamond) didn't read as a
  // handshake at all once rendered — verified side by side against
  // "trophy" (now Fantasy Five's nav icon, see below) in a real browser
  // screenshot before landing on this one, not just reasoned about blind.
  | "bracket"
  // Fantasy Five's admin-only "randomize squad" trigger (2026-09-17) — a
  // literal six-sided die face reads as "randomize" more directly than any
  // existing icon here would.
  | "dice"
  // Fantasy Five's admin-only "simulate whole round" trigger (2026-09-17,
  // reusing the same POST /events/simulate/round the Schedule page's own
  // button already calls) — two stacked play triangles read as
  // "fast-forward" distinctly from "zap" (already the on-fire/CTA icon).
  | "fast-forward";

@Component({
  selector: "app-nav-icon",
  standalone: true,
  template: `
    <svg [attr.width]="size" [attr.height]="size" viewBox="0 0 24 24" fill="none">
      @switch (name) {
        @case ("home") {
          <path
            d="M12 3.2L2.5 11H5v9h5.2v-6.2h3.6V20H19v-9h2.5L12 3.2z"
            [attr.fill]="active ? 'currentColor' : 'none'"
            [attr.fill-opacity]="active ? 0.18 : null"
          />
          <path
            d="M4 11L12 4l8 7M6 10v9h5v-5h2v5h5v-9"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        }
        @case ("news") {
          <!-- Photo + headline, not generic equal-width lines — reads as
               "article" specifically, not "list" or "menu". -->
          <rect
            x="5"
            y="4"
            width="14"
            height="16"
            rx="1"
            stroke="currentColor"
            stroke-width="2.2"
            [attr.fill]="active ? 'currentColor' : 'none'"
            [attr.fill-opacity]="active ? 0.18 : null"
          />
          <rect x="7.2" y="6.8" width="4" height="4" rx="0.6" fill="currentColor" />
          <line x1="13" y1="7.5" x2="16.8" y2="7.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          <line x1="13" y1="10" x2="16.8" y2="10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          <line x1="7.2" y1="14" x2="16.8" y2="14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          <line x1="7.2" y1="16.5" x2="13.5" y2="16.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        }
        @case ("picks") {
          <!-- Bullseye — "aiming for a correct call", not a plain checkmark
               (which reads as "done/verified", the wrong signal here). -->
          <circle
            cx="12"
            cy="12"
            r="8"
            stroke="currentColor"
            stroke-width="2"
            [attr.fill]="active ? 'currentColor' : 'none'"
            [attr.fill-opacity]="active ? 0.18 : null"
          />
          <circle cx="12" cy="12" r="4.6" stroke="currentColor" stroke-width="1.8" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" />
        }
        @case ("store") {
          <rect x="4" y="8" width="16" height="12" rx="1.5" stroke="currentColor" stroke-width="2.2" />
          <path d="M4 8l2-4h12l2 4" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" />
          <path d="M9 12v-1a3 3 0 0 1 6 0v1" stroke="currentColor" stroke-width="2.2" />
        }
        @case ("user") {
          <circle
            cx="12"
            cy="8"
            r="4"
            stroke="currentColor"
            stroke-width="2.2"
            [attr.fill]="active ? 'currentColor' : 'none'"
            [attr.fill-opacity]="active ? 0.18 : null"
          />
          <!-- Basketball-seam accent on the head — same seam language as
               the "ball"/"wheel" icons, so the profile icon reads as a
               player, not a generic account glyph. -->
          <path d="M12 4.3v7.4M8.3 8h7.4" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" />
          <path d="M4 20c0-4 4-6 8-6s8 2 8 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
        }
        @case ("wheel") {
          <circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="2.2" />
          <path
            d="M12 4v16M4 12h16M6.3 6.3l11.4 11.4M17.7 6.3L6.3 17.7"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
          />
          <circle cx="12" cy="12" r="2" fill="currentColor" />
        }
        @case ("packs") {
          <rect
            x="4.5"
            y="7.5"
            width="10"
            height="13"
            rx="1.5"
            transform="rotate(-8 9.5 14)"
            stroke="currentColor"
            stroke-width="1.9"
          />
          <rect x="9.5" y="6" width="10" height="13" rx="1.5" stroke="currentColor" stroke-width="1.9" />
        }
        @case ("cards") {
          <!-- A fanned hand of two cards — a collection, not a single
               portrait card (too close to the "user" icon's silhouette)
               and fanned outward rather than stacked-behind, so it doesn't
               read as a sealed "packs" icon either. -->
          <rect
            x="3.2"
            y="6.5"
            width="9.5"
            height="13"
            rx="1.4"
            transform="rotate(-13 8 13)"
            stroke="currentColor"
            stroke-width="2"
            [attr.fill]="active ? 'currentColor' : 'none'"
            [attr.fill-opacity]="active ? 0.18 : null"
          />
          <rect
            x="11.3"
            y="4.5"
            width="9.5"
            height="13"
            rx="1.4"
            transform="rotate(13 16 11)"
            stroke="currentColor"
            stroke-width="2"
            [attr.fill]="active ? 'currentColor' : 'none'"
            [attr.fill-opacity]="active ? 0.18 : null"
          />
          <circle cx="16" cy="9.2" r="1.3" fill="currentColor" transform="rotate(13 16 11)" />
        }
        @case ("schedule") {
          <rect
            x="4"
            y="5"
            width="16"
            height="15"
            rx="1.5"
            stroke="currentColor"
            stroke-width="2.2"
            [attr.fill]="active ? 'currentColor' : 'none'"
            [attr.fill-opacity]="active ? 0.18 : null"
          />
          <line x1="4" y1="9" x2="20" y2="9" stroke="currentColor" stroke-width="2.2" />
          <line x1="8" y1="3" x2="8" y2="6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
          <line x1="16" y1="3" x2="16" y2="6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
        }
        @case ("standings") {
          <!-- Ranked bars, echoing the wordmark's own logo bars — a
               leaderboard glyph, distinct from "trophy" (one achievement). -->
          <rect
            x="4"
            y="13"
            width="4.5"
            height="7"
            rx="1"
            stroke="currentColor"
            stroke-width="2"
            [attr.fill]="active ? 'currentColor' : 'none'"
            [attr.fill-opacity]="active ? 0.18 : null"
          />
          <rect
            x="9.75"
            y="7"
            width="4.5"
            height="13"
            rx="1"
            stroke="currentColor"
            stroke-width="2"
            [attr.fill]="active ? 'currentColor' : 'none'"
            [attr.fill-opacity]="active ? 0.18 : null"
          />
          <rect
            x="15.5"
            y="10"
            width="4.5"
            height="10"
            rx="1"
            stroke="currentColor"
            stroke-width="2"
            [attr.fill]="active ? 'currentColor' : 'none'"
            [attr.fill-opacity]="active ? 0.18 : null"
          />
        }
        @case ("teams") {
          <!-- Two overlapping player silhouettes — "browse teams/rosters",
               distinct from the single "user" (profile) icon. -->
          <circle
            cx="9"
            cy="8.5"
            r="3.2"
            stroke="currentColor"
            stroke-width="2.1"
            [attr.fill]="active ? 'currentColor' : 'none'"
            [attr.fill-opacity]="active ? 0.18 : null"
          />
          <path d="M3.5 20c0-3.8 2.7-6.3 5.5-6.3s5.5 2.5 5.5 6.3" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" />
          <circle cx="16.3" cy="9.3" r="2.6" stroke="currentColor" stroke-width="1.8" />
          <path d="M14.8 14.2c2.6.3 5.7 2.4 5.7 5.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        }
        @case ("trade") {
          <path
            d="M6 8h11l-3-3M17 8l-3 3"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <path
            d="M18 16H7l3-3M7 16l3 3"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        }
        @case ("trophy") {
          <!-- century badge + the perfect-round celebration banner. -->
          <path
            d="M8 4h8v4a4 4 0 0 1-8 0V4z"
            stroke="currentColor"
            stroke-width="2"
            stroke-linejoin="round"
            fill="currentColor"
            fill-opacity="0.14"
          />
          <path
            d="M8 5H5a3 3 0 0 0 3 4M16 5h3a3 3 0 0 1-3 4"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
          />
          <path d="M12 12v3M9 19h6M10 19v-2.5M14 19v-2.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        }
        @case ("flame") {
          <!-- on-a-roll badge + the double-double tag. -->
          <path
            d="M12 3c1 2.5-1 3.5-1 5.5 0 1.2 1 2 2 2s2-1 2-2.2c1.5 1 2.5 3 2.5 5C17.5 17 15 20 12 20s-5.5-3-5.5-6.7c0-3 1.8-5 3-7 .5 1 1 2 1.5 2.7-.3-2-.3-4.5 1-6z"
            stroke="currentColor"
            stroke-width="2"
            stroke-linejoin="round"
            fill="currentColor"
            fill-opacity="0.14"
          />
        }
        @case ("checkmark-shield") {
          <!-- perfect-round badge — a completed, verified round. -->
          <path
            d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"
            stroke="currentColor"
            stroke-width="2"
            stroke-linejoin="round"
            fill="currentColor"
            fill-opacity="0.14"
          />
          <path
            d="M8.5 12l2.5 2.5 4.5-5"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        }
        @case ("injury") {
          <!-- medical cross in a rounded shield — a player with an active
               injury report. -->
          <path
            d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"
            stroke="currentColor"
            stroke-width="2"
            stroke-linejoin="round"
            [attr.fill]="active ? 'currentColor' : 'none'"
            [attr.fill-opacity]="active ? 0.18 : null"
          />
          <path d="M12 8.5v7M8.5 12h7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
        }
        @case ("medal") {
          <!-- fallback for any badge id without a specific icon. -->
          <circle cx="12" cy="14" r="6" stroke="currentColor" stroke-width="2" fill="currentColor" fill-opacity="0.14" />
          <path d="M9.5 3.5l2.5 5 2.5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M10.5 12.5l1.5-1.5 1.5 1.5-1.5 3.5-1.5-3.5z" fill="currentColor" />
        }
        @case ("sprout") {
          <!-- first-call badge — a first pick made. -->
          <path
            d="M12 20v-7"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          />
          <path
            d="M12 13c0-3.5-3-4.5-6-4.5C6.3 12 8.5 14 12 13z"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linejoin="round"
            fill="currentColor"
            fill-opacity="0.14"
          />
          <path
            d="M12 10.5c0-4 3.3-5.5 6.5-5.5C18.3 9 15.7 11.3 12 10.5z"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linejoin="round"
            fill="currentColor"
            fill-opacity="0.14"
          />
        }
        @case ("zap") {
          <!-- on-fire indicator next to a player currently on a scoring streak. -->
          <path
            d="M13 2.5L5.5 13h4.7l-1.2 8.5 8.5-11.5h-5.2L13 2.5z"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linejoin="round"
            fill="currentColor"
            fill-opacity="0.2"
          />
        }
        @case ("ball") {
          <!-- basketball — the dashboard points-hint icon, and the wheel's hub. -->
          <circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="2" fill="currentColor" fill-opacity="0.1" />
          <path
            d="M12 3.5v17M3.5 12h17M6 6c2 2 2 10-0.5 12M18 6c-2 2-2 10 0.5 12"
            stroke="currentColor"
            stroke-width="1.4"
            stroke-linecap="round"
          />
        }
        @case ("tip") {
          <!-- default page-hint icon when a page doesn't pass a specific one. -->
          <circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="2" fill="currentColor" fill-opacity="0.1" />
          <path d="M12 8v5.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          <circle cx="12" cy="16.3" r="1.1" fill="currentColor" />
        }
        @case ("compass") {
          <!-- "Take a tour" button — a compass needle reads as "guide me
               around", where the old play-triangle read as "video". -->
          <circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="2" />
          <path
            d="M14.6 9.4l-1.8 4.3-4.4 1.9 1.8-4.3z"
            stroke="currentColor"
            stroke-width="1.4"
            stroke-linejoin="round"
            fill="currentColor"
            fill-opacity="0.35"
          />
          <circle cx="12" cy="12" r="1" fill="currentColor" />
        }
        @case ("album") {
          <!-- open book — the Cards hub's leaflet/album tile. -->
          <path
            d="M12 6.3c-1.9-1.3-4.3-1.7-6.5-1.2v12c2.2-.5 4.6-.1 6.5 1.2c1.9-1.3 4.3-1.7 6.5-1.2v-12c-2.2-.5-4.6-.1-6.5 1.2z"
            stroke="currentColor"
            stroke-width="2"
            stroke-linejoin="round"
            [attr.fill]="active ? 'currentColor' : 'none'"
            [attr.fill-opacity]="active ? 0.14 : null"
          />
          <line x1="12" y1="6.3" x2="12" y2="18.3" stroke="currentColor" stroke-width="1.6" />
        }
        @case ("logout") {
          <path
            d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <path
            d="M10.5 12h10M16.5 8l4 4-4 4"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        }
        @case ("install") {
          <!-- A phone with an arrow dropping onto it — "add to device", not
               a generic download-tray glyph. -->
          <rect x="6" y="2.5" width="12" height="19" rx="2.2" stroke="currentColor" stroke-width="2" />
          <path
            d="M12 8v7M8.5 12l3.5 3.5L15.5 12"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        }
        @case ("share") {
          <!-- iOS Safari's own share-sheet glyph, so the instruction step
               visually matches the icon the user is about to look for. -->
          <path
            d="M12 15V3M8 7l4-4 4 4"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <path
            d="M6 11v7a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-7"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        }
        @case ("dots-vertical") {
          <!-- Chrome's overflow-menu glyph, same reasoning as "share". -->
          <circle cx="12" cy="5.5" r="1.8" fill="currentColor" />
          <circle cx="12" cy="12" r="1.8" fill="currentColor" />
          <circle cx="12" cy="18.5" r="1.8" fill="currentColor" />
        }
        @case ("bell") {
          <path
            d="M18 8.5a6 6 0 0 0-12 0c0 6.5-2.5 8.5-2.5 8.5h17s-2.5-2-2.5-8.5z"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            [attr.fill]="active ? 'currentColor' : 'none'"
            [attr.fill-opacity]="active ? 0.14 : null"
          />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        }
        @case ("table") {
          <rect x="4" y="5" width="16" height="14" rx="1.5" stroke="currentColor" stroke-width="2.1" />
          <line x1="4" y1="10" x2="20" y2="10" stroke="currentColor" stroke-width="1.8" />
          <line x1="9.3" y1="10" x2="9.3" y2="19" stroke="currentColor" stroke-width="1.8" />
          <line x1="14.7" y1="10" x2="14.7" y2="19" stroke="currentColor" stroke-width="1.8" />
        }
        @case ("vote") {
          <path
            d="M5 10v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9"
            stroke="currentColor"
            stroke-width="2.1"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <path d="M3.5 10h17L18 4H6l-2.5 6z" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round" />
          <path
            d="M9 13.5l2 2 4-4"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        }
        @case ("star") {
          <path
            d="M12 3.5l2.6 5.6 6.1.6-4.6 4.1 1.3 6-5.4-3.1-5.4 3.1 1.3-6-4.6-4.1 6.1-.6 2.6-5.6z"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linejoin="round"
            [attr.fill]="active ? 'currentColor' : 'none'"
          />
        }
        @case ("sliders") {
          <!-- Adjustment sliders — "customize/build your own", the
               analytics builder's icon. -->
          <line x1="5" y1="19" x2="5" y2="5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          <line x1="12" y1="19" x2="12" y2="5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          <line x1="19" y1="19" x2="19" y2="5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          <circle cx="5" cy="9" r="2.2" fill="currentColor" stroke="none" />
          <circle cx="12" cy="15" r="2.2" fill="currentColor" stroke="none" />
          <circle cx="19" cy="7" r="2.2" fill="currentColor" stroke="none" />
        }
        @case ("bracket") {
          <!-- Bracket tree — two entrants converging up to a small trophy
               apex, the actual shape of a tournament bracket (see the
               type comment above for the two reverted drafts). Modeled
               after a user-supplied reference icon (a trophy atop a
               4-team bracket tree), simplified to two nodes for legibility
               at nav-icon size. -->
          <circle cx="5.5" cy="18" r="2" stroke="currentColor" stroke-width="1.8" [attr.fill]="active ? 'currentColor' : 'none'" [attr.fill-opacity]="active ? 0.18 : null" />
          <circle cx="18.5" cy="18" r="2" stroke="currentColor" stroke-width="1.8" [attr.fill]="active ? 'currentColor' : 'none'" [attr.fill-opacity]="active ? 0.18 : null" />
          <path d="M5.5 16v-2.5h4M18.5 16v-2.5h-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M9.5 13.5h5M12 13.5v-2.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          <path
            d="M9.3 4h5.4v2.3a2.7 2.7 0 0 1-5.4 0V4z"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linejoin="round"
            fill="currentColor"
            fill-opacity="0.16"
          />
          <path d="M9.3 4.6H7.3a2 2 0 0 0 2 2.6M14.7 4.6h2a2 2 0 0 1-2 2.6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
          <path d="M12 9v2.3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        }
        @case ("dice") {
          <rect
            x="4"
            y="4"
            width="16"
            height="16"
            rx="4"
            stroke="currentColor"
            stroke-width="2"
            [attr.fill]="active ? 'currentColor' : 'none'"
            [attr.fill-opacity]="active ? 0.14 : null"
          />
          <circle cx="8.3" cy="8.3" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="15.7" cy="8.3" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="8.3" cy="15.7" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="15.7" cy="15.7" r="1.4" fill="currentColor" stroke="none" />
        }
        @case ("fast-forward") {
          <path d="M4 5.5v13l9-6.5-9-6.5z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" fill="currentColor" fill-opacity="0.2" />
          <path d="M12.5 5.5v13l9-6.5-9-6.5z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" fill="currentColor" fill-opacity="0.2" />
        }
      }
    </svg>
  `,
})
export class NavIconComponent {
  @Input({ required: true }) name!: NavIconName;
  // Swaps in a soft duotone fill behind the icon's stroke for the six
  // primary-nav icons (home/news/picks/cards/user/schedule) — the "lit up"
  // look that stands in for the active-tab color change now that nav
  // buttons are icon-only and don't have a label to carry that signal.
  @Input() active = false;
  @Input() size = 20;
}
