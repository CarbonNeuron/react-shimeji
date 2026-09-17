# Bug: IE behaviors lose the weighted random roll at platform edges

## Current state
The `selectEdgeBehavior()` fix from the last round WORKS — mascots no longer unconditionally fall when they reach a platform edge. But the behavior system calls `selectNextBehavior()` which draws from the full behavior pool weighted by `frequency`. IE-specific behaviors (wall-climb, jump-to-IE, ceiling-crawl) have low frequency weights compared to mundane behaviors (sit, stand, walk, turn around). So at platform edges, mascots almost always pick a non-IE behavior — they sit down, turn around, or idle, instead of climbing or jumping.

Bowser was the only character that jumped/climbed, likely because his XML gives higher frequency to IE behaviors.

## How Java Shimeji-ee handles this
In the original Java Shimeji-ee, when a mascot is ON an IE (platform), it specifically uses IE-variant behaviors. The behavior selection isn't just "pick from the global pool" — there's contextual behavior selection where being on/near an IE biases toward IE behaviors. The `nextBehaviors` chains in the XML are designed so that IE-walking leads to IE-specific transitions.

## The fix needed
In `selectEdgeBehavior()` (mascot.ts), when a mascot triggers `lost-ground` at a platform edge:

1. **First, try to select ONLY from IE-relevant behaviors** — filter the behavior pool to behaviors whose conditions reference `activeIE` (or whose names contain "IE"/"ＩＥ"/wall/climb patterns). If one matches, use it.
2. **Only fall back to the full pool if no IE behavior matches** — this preserves the current behavior as a fallback.

Alternatively, look at how the behavior `nextBehaviors` chains work. When a mascot is doing `WalkWithIE` (walking on a platform), the `nextBehaviors` for that behavior should include IE-specific transitions. Check if:
- The current behavior's `nextBehaviors` already includes climb/jump behaviors
- The issue is that `selectEdgeBehavior()` calls `selectNextBehavior()` which uses `this.previous` — but `this.previous` may have been reset when `actions.cancel()` was called before `selectEdgeBehavior()`, losing the "I was walking on a platform" context

## Key files
- `packages/core/src/mascot.ts` — `selectEdgeBehavior()` (the method from the last fix), `legacyTick()` lost-ground handler
- `packages/core/src/behavior.ts` — `selectNext()` (line 253), `choose()` (line 271) — this is where the weighted selection happens
- Look at the XML behavior definitions for a character like Beemo — what are the `nextBehaviors` for `WalkWithIE`/`IEの上で歩く`? Do they chain to climb/jump behaviors?

## Constraints
- Run `npx vitest run` and `npx tsc --noEmit` — all must pass
- Don't break normal (non-IE) behavior transitions
- The existing 45 tests must still pass plus any new ones you add
- Work in `~/react-shimeji`
