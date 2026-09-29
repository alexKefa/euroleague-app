/**
 * One-off (2026-09-29): creates the `announcements` table (schema.ts) and
 * moves the two announcements that used to be hardcoded in the frontend's
 * shared/whats-new.ts into it, keeping their original ids so users who
 * already dismissed them don't see them again. Idempotent — safe to run on
 * both dev and production, and to re-run.
 *
 * Usage: npx tsx src/scripts/create-announcements-table.ts
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";

async function main() {
  await db.execute(sql`
    create table if not exists announcements (
      id text primary key,
      title_en text not null,
      title_el text not null,
      body_en text not null,
      body_el text not null,
      link text,
      cta_en text,
      cta_el text,
      icon varchar(40) not null,
      publish_at timestamptz not null default now(),
      expires_at timestamptz not null,
      active boolean not null default true,
      created_by_user_id uuid references users(id),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);

  const seed = [
    {
      id: "2026-09-28-fantasy-growing-budget",
      icon: "trophy",
      titleEn: "Your Fantasy budget now moves with your players",
      titleEl: "Ο προϋπολογισμός σου στο Fantasy ακολουθεί πλέον τους παίκτες σου",
      bodyEn: "Like EuroLeague Fantasy: when your players' prices rise after a round, your budget grows — when they fall, it shrinks.",
      bodyEl: "Όπως στο EuroLeague Fantasy: όταν ανεβαίνουν οι τιμές των παικτών σου μετά από μια αγωνιστική, ο προϋπολογισμός σου μεγαλώνει — όταν πέφτουν, μικραίνει.",
      link: "/fantasy",
      ctaEn: "See my budget",
      ctaEl: "Δες τον προϋπολογισμό μου",
      // Published a moment after the import one so it stays the newer of
      // the two, same order as the old hardcoded list.
      publishAt: "2026-09-28T00:00:01Z",
    },
    {
      id: "2026-09-28-fantasy-screenshot-import",
      icon: "share",
      titleEn: "Import your EuroLeague Fantasy team",
      titleEl: "Φέρε την ομάδα σου από το EuroLeague Fantasy",
      bodyEn: "Screenshot your squad in EuroLeague Fantasy, then tap Import in Fantasy Five — we'll copy it over for you to check and save.",
      bodyEl: "Τράβηξε στιγμιότυπο της ομάδας σου στο EuroLeague Fantasy και πάτα Εισαγωγή στο Fantasy Five — θα την αντιγράψουμε για να την ελέγξεις και να την αποθηκεύσεις.",
      link: "/fantasy",
      ctaEn: "Try it",
      ctaEl: "Δοκίμασέ το",
      publishAt: "2026-09-28T00:00:00Z",
    },
  ];
  for (const a of seed) {
    await db.execute(sql`
      insert into announcements (id, title_en, title_el, body_en, body_el, link, cta_en, cta_el, icon, publish_at, expires_at)
      values (${a.id}, ${a.titleEn}, ${a.titleEl}, ${a.bodyEn}, ${a.bodyEl}, ${a.link}, ${a.ctaEn}, ${a.ctaEl}, ${a.icon},
        ${a.publishAt}::timestamptz, ${a.publishAt}::timestamptz + interval '14 days')
      on conflict (id) do nothing
    `);
  }
  const [{ count }] = await db.execute<{ count: string }>(sql`select count(*) from announcements`);
  console.log(`announcements table ready (${count} row(s))`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
