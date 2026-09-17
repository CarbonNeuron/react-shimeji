# Feature: Mascot-to-mascot collision avoidance

## Goal
Mascots should be aware of each other and avoid walking through each other. When two mascots are about to collide, they should react — turn around, stop, jump over, or otherwise acknowledge the other mascot's presence instead of just phasing through.

## How it should work

1. **Collision detection**: Each tick, each mascot should check if any other mascot's bounding box overlaps or is about to overlap with theirs. The bounding box can be derived from the mascot's position (x, y) and sprite dimensions (anchorX, anchorY + some reasonable hitbox width/height — maybe 32x64 or derived from the sprite sheet).

2. **Avoidance behavior**: When a mascot detects another mascot in its path:
   - If walking and about to collide: turn around (flip `lookRight`) or stop
   - If falling toward another mascot: allow it (don't block gravity)
   - Keep it simple — no complex pathfinding, just basic "don't walk into each other"

3. **Implementation approach**: The engine already has a `MascotManager` or equivalent that tracks all mascots. Each mascot's `legacyTick()` gets `bounds` and `platforms` — we'd need to also pass sibling mascot positions. Options:
   - Add a `siblings` or `others` parameter to the tick that contains positions/bounding boxes of all other mascots
   - Or query the mascot manager/engine for nearby mascots during tick

4. **Soft collision, not hard**: Mascots shouldn't block each other rigidly (that causes physics issues). Instead, treat nearby mascots as a behavioral signal — "there's someone in my way, I should do something different." This is a behavior-level reaction, not a physics-level wall.

## Key constraints
- Performance: collision checks should be O(n) per mascot, not O(n²) — or if O(n²), keep it cheap (just position distance checks, no complex geometry)
- Don't break existing behavior transitions — collision avoidance should be a gentle nudge, not a hard override
- Mascots should still be able to exist near each other (e.g., both standing on the same platform), just not walk THROUGH each other
- Run `npx vitest run` and `npx tsc --noEmit` — all must pass
- Work in `~/react-shimeji`
- Do NOT bump versions or modify package.json
