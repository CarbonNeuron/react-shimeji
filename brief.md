# Bug Fix: Mascots falling through platform boxes

## Problem
After the Java engine port, mascots no longer interact with platform boxes (DOM elements marked with `data-shimeji-platform`). They fall right through them instead of landing on top, climbing sides, etc.

This is a regression from your last port commit. Before the port, platform interaction (walking on top of boxes, sitting on edges, climbing sides) worked correctly.

## Context
- Platform elements are resolved via `resolvePlatformElements()` in `packages/core/src/platform.ts` and read via `readPlatformRectangles()`.
- The engine passes platforms through to `mascot.tick()` → `legacyTick()` → action runtimes via `RuntimeContext.platforms`.
- `selectActivePlatform()` in `mascot.ts` picks the nearest/current platform and builds `activeIE` in `createEnvironment()`.
- The original Shimeji-ee Java source is in `~/react-shimeji/shimejieesrc/` for reference — check how `ComplexArea`, `MascotEnvironment`, `BorderedAction`, and IE (interactive environment) actions handle platform collision in the Java code, and make sure the TS port matches.

## What to investigate
- The `FallRuntime` uses `isOnFloor()` which checks `isOnTop(point, platform)` — verify the coordinate systems match (container-relative platforms vs mascot position).
- Check if `BorderedAction`-style border detection (`isOnBorder` in physics.ts) is correctly wired for platform-aware actions (Walk, Fall, etc.).
- Check if the `activeIE` environment rectangle is being used by action runtimes that need it (e.g., `WalkWithIE`, `FallWithIE`, IE-border actions).
- Check the `hasMore()` / `tick()` methods of action runtimes — are they receiving and using `context.platforms` correctly?
- Look at the Java source for how `getEnvironment().getActiveIE()` feeds into bordered actions and make sure the TS equivalent works the same way.

## Requirements
- Mascots must land on platform boxes, walk on them, sit on edges, and climb their sides — exactly like they did before the port.
- All existing tests must still pass (`npx vitest run`).
- `npx tsc --noEmit` must be clean.
- Do NOT break any other behavior (falling, walking on container floor, wall bouncing, breeding, dragging).

## Verification
After fixing, run:
```
npx vitest run
npx tsc --noEmit
```
Both must pass with zero errors.
