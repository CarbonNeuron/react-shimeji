# Bug Fix: Two issues with the current engine

## Issue 1: Mascots stuck above the top of the screen
Mascots spawn at `bounds.y + 2` (which is y=2, near the top of the container) but they're getting stuck there instead of falling down. Users can only see their feet poking out from the top. The Fall behavior is not triggering properly from the spawn position — either the `isOnTop` ceiling check is catching them (tolerance issue), or the initial behavior selection is picking a walk/stand instead of Fall.

Fix the spawn so mascots reliably fall from the top to the floor of the container on first spawn.

## Issue 2: Mascots fall through platform boxes (DOM elements)
Mascots no longer interact with platform boxes (`data-shimeji-platform` DOM elements). They fall right through them instead of landing on top, climbing sides, etc. This is a regression from the Java engine port.

Your previous fix for this (border tolerance, FallWithIE/WalkWithIE attachment checks) was generated but never got committed because the tree was already clean when you ran. You need to redo that fix:
- Restore sub-pixel-safe border detection for fractional DOM rectangles in `physics.ts`
- Fix `FallWithIE`/`WalkWithIE` attachment checks in `action.ts`
- Make sure `isOnFloor`/`isOnTop`/`isOnWall` tolerance values work with real DOM `getBoundingClientRect()` values (which are fractional floats, not integers)

## Files to look at
- `packages/core/src/engine.ts` — spawn logic (~line 103-130)
- `packages/core/src/physics.ts` — border detection, `isOnTop`/`isOnFloor`/`isOnWall`, tolerance values
- `packages/core/src/action.ts` — FallRuntime, CarryFallRuntime, CarryMoveRuntime, border checks
- `packages/core/src/mascot.ts` — `ensureBehavior`, `legacyTick`, `selectActivePlatform`
- Java reference source: `~/react-shimeji/shimejieesrc/` for how the original handles spawning and platform detection

## Requirements
- Mascots must spawn and reliably fall to the container floor
- Mascots must land on platform boxes, walk on them, sit on edges, climb sides
- All existing tests must pass (`npx vitest run`)
- `npx tsc --noEmit` must be clean
- Do NOT break other behaviors (walking, wall bouncing, breeding, dragging)

## Verification
```
npx vitest run
npx tsc --noEmit
```
Both must pass with zero errors.
