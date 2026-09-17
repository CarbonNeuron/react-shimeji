# Bug: Mascots stuck in infinite flip-loop when spawning at same position

## Problem
When multiple mascots spawn at the same X coordinate (which happens often since `engine.ts` spawn picks random X within bounds), they overlap and get stuck in an infinite flip-flop loop:

1. Mascot A moves right, detects sibling B ahead → collision triggers → revert x, zero vx, flip lookRight
2. Next tick: Mascot A now moves left, detects sibling B ahead again → collision triggers → flip back
3. Repeat forever

## Previous fix attempt (FAILED)
Added `wasAlreadyOverlapping` check to skip collision when the previous frame's hitbox already overlapped. This doesn't work because the collision *response* reverts `this.state.x = previous.x` — so the mascot never actually separates, and `wasAlreadyOverlapping` is true every frame after the first collision... but on the *first* frame they weren't overlapping yet (they spawned at the same spot and then one moved), so collision fires, reverts position, and then subsequent frames they ARE overlapping so it doesn't fire — but by then the flip already happened and the cycle continues on alternating frames.

## Where to fix
`packages/core/src/mascot.ts`, method `avoidSiblingCollision()` (lines ~241-280).

Current collision response (lines 277-279):
```ts
this.state.x = previous.x;
this.state.vx = 0;
this.state.lookRight = !this.state.lookRight;
```

## What needs to happen
The collision system needs to handle the "already overlapping" case gracefully. When two mascots are already overlapping (spawned at same spot), they should walk *apart* instead of flip-flopping. Possible approaches:

1. **Separation nudge**: When already overlapping, instead of reverting + flipping, nudge the mascot in the direction *away* from the sibling's center (push them apart).
2. **Cooldown/flag**: After a collision triggers, give the mascot a brief cooldown (e.g. a few ticks) before collision can trigger again, so it has time to actually walk away.
3. **Only collide when approaching**: Check relative velocity — only trigger collision when the mascots are actually moving toward each other, not when one is trying to move away.

Option 3 is probably cleanest. The key insight: if `dx > 0` (moving right) and the sibling is to the right, that's an approach. But if `dx > 0` and the sibling is to the LEFT, we're already moving away — don't interfere. Current code checks `isAhead` which does this... but the problem is the flip makes "ahead" toggle every frame.

A better approach might be: **don't flip direction on collision at all** — just stop forward movement (revert x, zero vx) without flipping. The mascot's current behavior will eventually time out and a new behavior will be selected (possibly walking the other way). This prevents the flip-flop entirely while still preventing mascots from walking through each other.

Or combine: only flip if the mascot wasn't already flipped by a collision recently.

## Constraints
- Don't break the existing collision avoidance for mascots that are NOT overlapping (walking toward each other from a distance should still work)
- Tests must pass: `npx vitest run` (currently 50 passing)
- Type check must pass: `npx tsc --noEmit`
- Add a regression test for this specific scenario: two mascots spawning at the same position should not get stuck

## Files likely involved
- `packages/core/src/mascot.ts` — `avoidSiblingCollision()` method, `collisionBox()` method, collision constants
- `packages/core/src/engine.test.ts` — add regression test here
