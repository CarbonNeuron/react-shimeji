import type { MascotState, Point, Rectangle } from "./types";

/** Clamps a number to an inclusive range. */
export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

/** Returns whether a point lies on the top edge of a rectangle. */
export function isOnTop(point: Point, rectangle: Rectangle, tolerance = 1): boolean {
  return point.x >= rectangle.x - tolerance && point.x <= rectangle.x + rectangle.width + tolerance && Math.abs(point.y - rectangle.y) <= tolerance;
}

/** Returns whether a point lies on the bottom edge of a rectangle. */
export function isOnBottom(point: Point, rectangle: Rectangle, tolerance = 1): boolean {
  return point.x >= rectangle.x - tolerance && point.x <= rectangle.x + rectangle.width + tolerance && Math.abs(point.y - rectangle.y - rectangle.height) <= tolerance;
}

/** Returns whether a point lies on the left edge of a rectangle. */
export function isOnLeft(point: Point, rectangle: Rectangle, tolerance = 1): boolean {
  return point.y >= rectangle.y - tolerance && point.y <= rectangle.y + rectangle.height + tolerance && Math.abs(point.x - rectangle.x) <= tolerance;
}

/** Returns whether a point lies on the right edge of a rectangle. */
export function isOnRight(point: Point, rectangle: Rectangle, tolerance = 1): boolean {
  return point.y >= rectangle.y - tolerance && point.y <= rectangle.y + rectangle.height + tolerance && Math.abs(point.x - rectangle.x - rectangle.width) <= tolerance;
}

/** Returns whether an anchor satisfies an action's boundary requirement. */
export function isOnBorder(state: MascotState, bounds: Rectangle, border: "Floor" | "Wall" | "Ceiling" | undefined): boolean {
  if (!border) return true;
  if (border === "Floor") return isOnBottom(state, bounds);
  if (border === "Ceiling") return isOnTop(state, bounds);
  return isOnLeft(state, bounds) || isOnRight(state, bounds);
}

/** Advances ballistic motion and clamps the mascot to the work-area boundaries. */
export function applyGravity(
  state: MascotState,
  bounds: Rectangle,
  frameScale: number,
  gravity: number,
  resistanceX = 0.05,
  resistanceY = 0.01,
): boolean {
  state.x = clamp(state.x + state.vx * frameScale, bounds.x, bounds.x + bounds.width);
  state.y = clamp(state.y + state.vy * frameScale, bounds.y, bounds.y + bounds.height);
  state.vx *= Math.max(0, 1 - resistanceX * frameScale);
  state.vy = state.vy * Math.max(0, 1 - resistanceY * frameScale) + gravity * frameScale;
  if (state.y >= bounds.y + bounds.height) { state.y = bounds.y + bounds.height; state.vy = 0; return true; }
  if (state.x <= bounds.x || state.x >= bounds.x + bounds.width) { state.vx = 0; return true; }
  return false;
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
