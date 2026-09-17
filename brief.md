# Bug: IE (Interactive Environment / Platform) behaviors never trigger

## Problem
Mascots land on platforms and walk on them correctly, but **never jump to platforms, climb platform walls, or interact with platform edges** (IE behaviors like `IEの壁を登る`, `IEを右に投げる`, `IEの天井でずりずり`, etc. from the XML behavior definitions).

These IE behaviors have conditions that check things like:
- `#{mascot.environment.activeIE.visible}` 
- `#{mascot.environment.activeIE.topBorder.isOn(mascot.anchor)}`
- `#{mascot.anchor.x >= mascot.environment.activeIE.left && mascot.anchor.x < mascot.environment.activeIE.right}`

## What works
- Mascots spawn, fall, land on the floor
- Mascots land on platform elements (`[data-shimeji-platform]`) and walk on them
- `selectActivePlatform()` in `mascot.ts` does find platforms and sets `activeIE`

## What doesn't work
- Mascots never jump FROM floor TO a platform
- Mascots never climb platform side walls
- Mascots never crawl along platform ceilings
- Basically all IE-prefixed behaviors from the XML are dormant

## Key files
- `packages/core/src/mascot.ts` — `createEnvironment()` (line ~211), `selectActivePlatform()` (line ~237), `environmentRectangle()` / `edge()` helpers
- `packages/core/src/behavior.ts` — `selectNext()`, condition evaluation via `evaluateExpression()`, expression parser
- `packages/core/src/action.ts` — `selectBorder()`, `matchingActivePlatform()`, `CarryFallRuntime`, `CarryMoveRuntime`, `JumpRuntime`
- `packages/core/src/physics.ts` — `isOnTop/isOnBottom/isOnLeft/isOnRight`, `BORDER_TOLERANCE`

## Hypotheses to investigate (run the code, don't just read it)

1. **`activeIE.visible` is false when it should be true** — `selectActivePlatform()` has a fallback that finds the nearest platform within 400px (`PLATFORM_NEARBY_DISTANCE`). When a mascot is walking on the floor near a platform, does this fallback actually fire? Or does the function return `undefined` because the mascot isn't "on" any platform and isn't falling? If `activeIE.visible` stays false, ALL IE behavior conditions fail.

2. **Expression evaluation bug** — The condition expressions in the XML use `#{...}` syntax with property access like `mascot.environment.activeIE.visible` and method calls like `mascot.environment.floor.isOn(mascot.anchor)`. Does the expression evaluator in `behavior.ts` correctly resolve these deep property paths against the `MascotEnvironment` object? Are `topBorder`, `leftBorder`, `rightBorder`, `bottomBorder` properties actually present on the `activeIE` object returned by `createEnvironment()`?

3. **Missing border objects on activeIE** — In `createEnvironment()`, `activeIE` is built from `environmentRectangle(platform)` which returns `{x, y, width, height}` plus `visible: true`. But the XML conditions reference `activeIE.topBorder.isOn(...)`, `activeIE.leftBorder.isOn(...)` etc. Does `environmentRectangle()` or the environment object actually have these `.topBorder` / `.leftBorder` sub-objects with `.isOn()` methods? If not, that's the bug — conditions referencing nonexistent properties would evaluate to false/undefined.

4. **`JumpRuntime` targetX/targetY resolution** — Jump behaviors define target coordinates via expressions. Does the jump action correctly resolve target positions pointing at platform locations?

## Your task

1. **Write a focused test** that creates a mascot on the floor with a platform nearby, ticks it repeatedly, and asserts that an IE behavior (jump-to-IE, wall-climb, etc.) eventually gets selected. Log what `selectActivePlatform()` returns and what `activeIE` looks like in the environment passed to behavior selection.

2. **Find and fix the root cause** — most likely hypothesis #3 (missing border sub-objects on activeIE) but verify by running code, not guessing.

3. **Run `npx vitest run` and `npx tsc --noEmit`** — all tests must pass, no type errors.

4. Do NOT bump versions or modify package.json. Just fix the bug and add tests.
