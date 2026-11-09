// Synced room state (CLUTCH_COURT_SPEC.md §6.2), via @colyseus/schema's
// decorator-free schema() API. The client reads it through the SDK's
// reflection, so it never imports this file.
import { schema, t, type SchemaType } from "@colyseus/schema";

export const CourtPlayer = schema(
  {
    userId: t.string(),
    name: t.string(),
    teamColorPrimary: t.string(),
    teamColorSecondary: t.string(),
    /** Raw club code (the client maps it to its display abbreviation). */
    teamCode: t.string(),
    number: t.number(),
    x: t.number(),
    z: t.number(),
    rotY: t.number(),
    anim: t.string(), // idle | run | shoot | emote:<id>
    connected: t.boolean(),
    letters: t.string(), // H-O-R-S-E progress (M4)
    eliminated: t.boolean(),
    /** Join order, for H-O-R-S-E turn order (M4). */
    joinedAt: t.number(),
  },
  "CourtPlayer"
);
export type CourtPlayer = SchemaType<typeof CourtPlayer>;

export const CourtState = schema(
  {
    players: t.map(CourtPlayer),
    ownerId: t.string(),
    /** Court owner's club: paints the keys and the logo at the top of the arc. */
    courtColor: t.string(),
    courtLogoUrl: t.string(),
    mode: t.string(), // shootaround | horse
    phase: t.string(), // free | lobby | setting | matching | over
    turnOrder: t.array("string"),
    turnId: t.string(),
    setterId: t.string(),
    spotX: t.number(),
    spotZ: t.number(),
    spotHoop: t.string(),
    turnDeadline: t.number(),
  },
  "CourtState"
);
export type CourtState = SchemaType<typeof CourtState>;
