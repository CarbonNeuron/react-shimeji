import type { MascotState, Point, Rectangle } from "./types";

// Mascot anchors and evaluated action targets use truncated legacy pixels,
// while DOMRect edges may lie anywhere between CSS pixels. Any distance below
// one pixel is therefore the same legacy coordinate; an exact adjacent pixel
// remains distinct.
const BORDER_TOLERANCE = 1 - Number.EPSILON / 2;

function isWithinSpan(value: number, minimum: number, maximum: number, tolerance: number): boolean {
  const distance = value < minimum ? minimum - value : value > maximum ? value - maximum : 0;
  return distance <= tolerance;
}

/** Clamps a number to an inclusive range. */
export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

/** Returns whether a point lies on the top edge of a rectangle. */
export function isOnTop(point: Point, rectangle: Rectangle, tolerance = BORDER_TOLERANCE): boolean {
  return isWithinSpan(point.x, rectangle.x, rectangle.x + rectangle.width, tolerance) && Math.abs(point.y - rectangle.y) <= tolerance;
}

/** Returns whether a point lies on the bottom edge of a rectangle. */
export function isOnBottom(point: Point, rectangle: Rectangle, tolerance = BORDER_TOLERANCE): boolean {
  return isWithinSpan(point.x, rectangle.x, rectangle.x + rectangle.width, tolerance) && Math.abs(point.y - rectangle.y - rectangle.height) <= tolerance;
}

/** Returns whether a point lies on the left edge of a rectangle. */
export function isOnLeft(point: Point, rectangle: Rectangle, tolerance = BORDER_TOLERANCE): boolean {
  return isWithinSpan(point.y, rectangle.y, rectangle.y + rectangle.height, tolerance) && Math.abs(point.x - rectangle.x) <= tolerance;
}

/** Returns whether a point lies on the right edge of a rectangle. */
export function isOnRight(point: Point, rectangle: Rectangle, tolerance = BORDER_TOLERANCE): boolean {
  return isWithinSpan(point.y, rectangle.y, rectangle.y + rectangle.height, tolerance) && Math.abs(point.x - rectangle.x - rectangle.width) <= tolerance;
}

/** Returns whether an anchor satisfies an action's boundary requirement. */
export function isOnBorder(
  state: MascotState,
  bounds: Rectangle,
  border: "Floor" | "Wall" | "Ceiling" | undefined,
  platform?: Rectangle,
): boolean {
  if (!border) return true;
  if (border === "Floor") return isOnBottom(state, bounds) || (platform !== undefined && isOnTop(state, platform));
  if (border === "Ceiling") return isOnTop(state, bounds) || (platform !== undefined && isOnBottom(state, platform));
  return isOnLeft(state, bounds)
    || isOnRight(state, bounds)
    || (platform !== undefined && (isOnLeft(state, platform) || isOnRight(state, platform)));
}

/** Returns whether a point is on a floor (platform top or work-area bottom). */
export function isOnFloor(point: Point, bounds: Rectangle, platforms: readonly Rectangle[] = []): boolean {
  return platforms.some((platform) => isOnTop(point, platform)) || isOnBottom(point, bounds);
}

/** Returns whether a point is on the wall it is moving/facing toward. */
export function isOnWall(point: Point, bounds: Rectangle, lookRight: boolean, platforms: readonly Rectangle[] = []): boolean {
  return lookRight
    ? platforms.some((platform) => isOnLeft(point, platform)) || isOnRight(point, bounds)
    : platforms.some((platform) => isOnRight(point, platform)) || isOnLeft(point, bounds);
}

/**
 * Advances one legacy Fall tick. Velocity is damped and accelerated before
 * movement, then the path is sampled one pixel at a time just like Shimeji-ee.
 */
export function applyGravity(
  state: MascotState,
  bounds: Rectangle,
  frameScale: number,
  gravity: number,
  resistanceX = 0.05,
  resistanceY = 0.1,
  platform?: Rectangle,
): boolean {
  const platforms = platform ? [platform] : [];
  const steps = Math.max(1, Math.round(frameScale));
  let stopped = false;
  for (let frame = 0; frame < steps && !stopped; frame += 1) {
    state.vx -= state.vx * resistanceX;
    state.vy = state.vy - state.vy * resistanceY + gravity;
    const dx = Math.trunc(state.vx);
    const dy = Math.trunc(state.vy);
    const divisions = Math.max(1, Math.abs(dx), Math.abs(dy));
    const start = { x: state.x, y: state.y };
    for (let index = 0; index <= divisions; index += 1) {
      const x = start.x + Math.trunc((dx * index) / divisions);
      const y = start.y + Math.trunc((dy * index) / divisions);
      state.x = x;
      state.y = y;
      if (dy > 0) {
        for (let offset = -80; offset <= 0; offset += 1) {
          state.y = y + offset;
          if (isOnFloor(state, bounds, platforms)) { stopped = true; break; }
        }
        if (stopped) break;
        state.y = y;
      }
      if (isOnWall(state, bounds, state.lookRight, platforms)) { stopped = true; break; }
    }
  }
  return stopped;
}

/** Moves a mascot toward a target without overshooting it. */
export function moveToward(state: MascotState, target: Point, speed: number, frameScale: number): boolean {
  const dx = target.x - state.x;
  const dy = target.y - state.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= Math.max(0.001, speed * frameScale)) {
    state.x = target.x;
    state.y = target.y;
    return true;
  }
  state.x += (dx / distance) * speed * frameScale;
  state.y += (dy / distance) * speed * frameScale;
  return false;
}
