import { db } from "../db/client.js";
import { collectibles } from "../db/schema.js";

// One-off (2026-09-02), companion to reset-2026-27-season-data.ts's
// players.photo_url reset. collectibles.image_url is a snapshot copied from
// player.photoUrl at catalog-generation time (scripts/expand-collectibles.ts)
// rather than a live join — so nulling players.photo_url alone left every
// card's own baked-in image untouched. Nulls every collectible's image_url;
// CollectibleCardComponent's jersey-silhouette fallback (same shape as
// PlayerPhotoComponent's) covers the rest. Card identity (id, name, tier,
// pointsCost, team) and every user_collectibles ownership/trade/wishlist row
// are untouched — re-run scripts/collectibles:expand (or the admin
// PATCH /collectibles/:id) once real 2026-27 photos exist to repopulate.
async function main() {
  const updated = await db.update(collectibles).set({ imageUrl: null }).returning({ id: collectibles.id });
  console.log(`Cleared imageUrl on ${updated.length} collectible row(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error("clear-collectible-images failed:", err);
  process.exit(1);
});
