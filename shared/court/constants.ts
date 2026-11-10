// Clutch Court — world and physics constants (CLUTCH_COURT_SPEC.md §4).
// Shared by the Angular client and the court server: one source of truth.
// Units: metres, seconds, kilograms. Y is up. Hoop A sits at -z, hoop B at +z.

export const GRAVITY = 9.81;
export const PHYSICS_STEP = 1 / 60;

// FIBA full court.
export const COURT_LENGTH = 28;
export const COURT_WIDTH = 15;
export const HALF_LENGTH = COURT_LENGTH / 2;
export const HALF_WIDTH = COURT_WIDTH / 2;

// Run-off around the court up to the fence (outdoor court).
export const FENCE_HALF_WIDTH = HALF_WIDTH + 2.5;
export const FENCE_HALF_LENGTH = HALF_LENGTH + 2.5;
export const FENCE_HEIGHT = 3.6;
/** How close a player's centre may get to the fence. */
export const PLAYER_FENCE_MARGIN = 0.4;

// Hoop.
export const RIM_HEIGHT = 3.05;
export const RIM_INNER_RADIUS = 0.225;
export const RIM_TUBE_RADIUS = 0.01;
/** Distance from the backboard face to the rim's inner front edge. */
export const RIM_BOARD_GAP = 0.15;
export const BACKBOARD_WIDTH = 1.8;
export const BACKBOARD_HEIGHT = 1.05;
export const BACKBOARD_THICKNESS = 0.05;
/** Bottom edge of the board above the floor (FIBA 2.90 m). */
export const BACKBOARD_BOTTOM = 2.9;
/** Board face distance in from the baseline. */
export const BOARD_FROM_BASELINE = 1.2;
export const POLE_RADIUS = 0.1;
/** Pole centre distance behind the baseline. */
export const POLE_BEHIND_BASELINE = 1.0;

// Markings.
export const THREE_POINT_RADIUS = 6.75;
/** Corner-three straight segments sit this far in from the sidelines. */
export const THREE_POINT_CORNER_INSET = 0.9;
export const FREE_THROW_FROM_BOARD = 4.6;
export const KEY_WIDTH = 4.9;
export const CENTER_CIRCLE_RADIUS = 1.8;

// Ball.
export const BALL_RADIUS = 0.12;
export const BALL_MASS = 0.6;
// Restitution is applied by the static surface (combine rule "max", ball 0).
export const RESTITUTION_GROUND = 0.75;
export const RESTITUTION_RIM = 0.55;
export const RESTITUTION_BOARD = 0.6;
export const RESTITUTION_POLE = 0.5;
export const RESTITUTION_FENCE = 0.3;
/** Backspin on release, rad/s (about 2 rev/s). */
export const BALL_BACKSPIN = 12;

// Player.
export const PLAYER_SPEED = 4.5;
export const PLAYER_RADIUS = 0.35;
export const RELEASE_HEIGHT = 2.2;

// Shot pipeline.
export const SHOT_MAX_SIM_SECONDS = 4;
/** After a make, keep simulating this long (the ball drops and bounces). */
export const SHOT_AFTER_MAKE_SECONDS = 1.4;
export const SHOT_KEYFRAME_HZ = 30;
export const SHOT_COOLDOWN_SECONDS = 0.8;
/** A hoop counts as "in front" of the player inside ±60°. */
export const SHOT_TARGET_HALF_ANGLE = Math.PI / 3;
/** Horizontal distance below which the release point is pulled back (layup). */
export const SHOT_MIN_DISTANCE = 0.9;

// Layups: shooting while driving at the rim from close range. Released off a
// jump with the arm extended, a gather step closer, on a soft arc, and on a
// faster meter.
export const LAYUP_RELEASE_HEIGHT = 2.8;
/** Eligible within this horizontal distance of the rim centre... */
export const LAYUP_MAX_DISTANCE = 3.2;
/** ...while moving at least this fast towards it (m/s). */
export const LAYUP_MIN_APPROACH = 1.6;
/** The gather carries the release this much closer to the rim. */
export const LAYUP_GATHER = 0.6;
/** Never released closer than this to the rim centre. */
export const LAYUP_MIN_RELEASE_DISTANCE = 0.55;
export const LAYUP_APEX_ABOVE_RIM = 0.45;
/** Timing-error multiplier (on top of the distance factor). Tuned against Rapier: perfect 100%, slightly off ~95%, clearly off ~58%, fully mistimed ~35%. */
export const LAYUP_ERROR_SCALE = 1.5;
export const LAYUP_METER_FILL_SECONDS = 0.6;
/** The server accepts a claimed layup if its own approach speed is at least this share of the minimum (network jitter). */
export const LAYUP_SERVER_APPROACH_TOLERANCE = 0.6;

// Shoot meter (hold-and-release). The meter value rises 0 -> 1 linearly over
// METER_FILL_SECONDS; releasing inside the green window around
// METER_SWEET_CENTER is a perfect release. Holding past the top auto-releases
// as a fully late shot after METER_OVERHOLD_SECONDS.
export const METER_FILL_SECONDS = 0.95;
export const METER_OVERHOLD_SECONDS = 0.2;
export const METER_SWEET_CENTER = 0.8;
export const METER_SWEET_HALF_WIDTH = 0.055;
/** Meter distance from the sweet centre that maps to |timingError| = 1. */
export const METER_ERROR_SPAN = 0.4;
/** |timingError| at or below this is a perfect (green) release. */
export const PERFECT_TIMING = METER_SWEET_HALF_WIDTH / METER_ERROR_SPAN;
