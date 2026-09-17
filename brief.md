# Bug: Mascots don't climb platform walls or jump between platforms — they just fall off edges

## What's happening
Mascots land on platforms (both the countdown boxes and the new decorative ledges). They walk on top of them. But when they reach the edge of a platform, they just **fall off**. They never:
- Climb down the side wall of a platform
- Climb up the side wall of a platform
- Jump from one platform to another
- Crawl along the bottom/ceiling of a platform

## What we already know works
- `activeIE.visible` is true when mascots are near platforms (confirmed by unit test)
- `activeIE` has proper `.topBorder`, `.leftBorder`, `.rightBorder`, `.bottomBorder` objects with `.isOn()` methods
- Platform detection (`selectActivePlatform()`) works — mascots DO land on and walk on platforms
- The engine's `JumpToIE` behavior selection works in a unit test

## The real problem
When a mascot is walking on top of a platform and reaches the edge, the behavior system needs to select an IE-related next behavior (wall-climb, jump, etc.) instead of just falling. This is about **behavior transitions at platform edges**, not platform detection.

In the original Java Shimeji-ee:
- When a mascot walks to the edge of an IE, it checks `isOnTop(anchor, activeIE)` and can choose WalkWithIE, ClimbDownIE, JumpFromIE, etc.
- The `WalkWithIE` border type is `Floor` tied to the IE element, so `lost-ground` fires when the mascot walks past the edge
- On `lost-ground`, the behavior controller picks a next behavior — which SHOULD include IE wall behaviors

## Debug approach

1. **Add temporary console.log debugging** to `packages/core/src/mascot.ts`:
   - In `selectNextBehavior()`: log what behavior was selected and the full list of candidates with their conditions
   - In `createEnvironment()`: log what `activeIE` looks like
   - In the `legacyTick()` lost-ground handler: log when lost-ground fires and what fall behavior is chosen

2. **Run the dev server** at port 3335 and load it in a browser. Watch the console output. See what's actually happening when a mascot reaches a platform edge:
   - Does `activeIE.visible` stay true at the edge?
   - What behaviors are candidates for next selection?
   - Are IE behaviors in the candidate list but losing the random weight roll?
   - Or are IE behavior conditions evaluating to false?

3. **Check the behavior XML conditions** for wall-climb behaviors. They typically require:
   - `activeIE.visible == true`
   - Mascot must be at the correct edge (e.g., `activeIE.rightBorder.isOn(anchor)` for right-wall climb)
   - `lookRight` must match the wall direction

4. **Check if `selectActivePlatform()` maintains the platform reference** when the mascot is at the edge. The "stay on current platform" check uses tolerance 2 — if the mascot is exactly at the edge, does it still count as "on" the platform? Or does `activePlatformElement` get cleared right when the mascot needs it most?

5. **Fix the root cause** — don't just add logging, actually fix whatever is preventing IE edge behaviors from being selected.

6. **Remove all temporary logging** before finishing.

7. Run `npx vitest run` and `npx tsc --noEmit` — all must pass.

Work in `~/react-shimeji` (the engine repo), NOT in `~/LuciaRetirementCountdown`.
