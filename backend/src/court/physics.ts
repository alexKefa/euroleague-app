// One Rapier world for the whole process. A shot is simulated start to finish
// in a single synchronous call (~4 ms) and its ball is removed afterwards, so
// rooms can share the world without interfering (spec §5.5/§5.6).
import RAPIER from "@dimforge/rapier3d-compat";
import { CourtPhysics, type RapierApi } from "../../../shared/court/sim.js";

let physics: CourtPhysics | null = null;

export async function initCourtPhysics(): Promise<void> {
  if (physics) return;
  await RAPIER.init();
  physics = new CourtPhysics(RAPIER as unknown as RapierApi);
}

export function courtPhysics(): CourtPhysics {
  if (!physics) throw new Error("court physics not initialised");
  return physics;
}
