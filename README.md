# react-shimeji

A dependency-free [Shimeji](https://en.wikipedia.org/wiki/Shimeji_(software)) engine for the web. Tiny desktop mascots that walk, climb, jump, and interact — rendered on any webpage with zero runtime dependencies.

Ships as two packages:

- **`@react-shimeji/core`** — framework-agnostic TypeScript engine (no dependencies)
- **`@react-shimeji/react`** — React 18+ bindings (peer dependency on React)

Both publish ESM, CommonJS, source maps, and full TypeScript declarations.

## Features

- 🎭 **Full behavior engine** — weighted behavior selection, action trees (sequence, select, reference, embedded), physics, gravity, boundary awareness, dragging
- 🖼️ **Spritesheet & individual sprites** — atlas rectangles or standalone image URLs
- 🧮 **Safe expression evaluator** — sandboxed AST interpreter for behavior conditions (no `eval()`)
- 🌍 **Bilingual format support** — parses both English and Japanese XML/JSON character definitions
- 🧹 **Zero leaks by design** — all timers, listeners, animation frames, and blob URLs are tracked and cleaned up on `destroy()`
- 📦 **Zero runtime dependencies** — core is pure TypeScript
- ⚛️ **React-friendly** — declarative `<ShimejiContainer>` or imperative `useShimeji` hook

## Quick Start

### React

```tsx
import { ShimejiContainer } from "@react-shimeji/react";
import type { CharacterSpec } from "@react-shimeji/core";

// Load your character specs (from JSON, a catalog, or parsed XML)
const characters: CharacterSpec[] = await loadMyCharacters();

export function App() {
  return (
    <ShimejiContainer
      characters={characters}
      count={15}
      randomize
      enabled
      style={{ minHeight: "100vh" }}
    >
      <YourApp />
    </ShimejiContainer>
  );
}
```

That's it. 15 random mascots live inside the wrapper, use its edges as walls and floor, and scroll with it.

### Vanilla TypeScript / JavaScript

```ts
import { ShimejiEngine, loadCharacter } from "@react-shimeji/core";

const engine = new ShimejiEngine(document.body);
const character = await loadCharacter("/shimeji/beemo/configuration.json");

engine.registerCharacter(character);
const mascotId = engine.spawn(character.id, { x: 300, y: 100 });

// Listen for clicks on mascots
const unsubscribe = engine.on("click", (mascot) => {
  console.log("clicked", mascot.id);
});

// Clean up everything — idempotent, safe to call multiple times
engine.destroy();
```

## API

### `@react-shimeji/core`

#### `ShimejiEngine`

The main engine class. The supplied container is the mascot coordinate system and clipping boundary. Platform selectors and element arrays are limited to descendants of that container.

```ts
const engine = new ShimejiEngine(container: HTMLElement, options?: ShimejiEngineOptions);
```

| Method | Description |
|---|---|
| `registerCharacter(spec)` | Register a character specification for spawning |
| `unregisterCharacter(id, removeAll?)` | Unregister a character, optionally removing its mascots |
| `spawn(characterId, options?)` | Spawn a mascot, returns its unique ID |
| `remove(mascotId)` | Remove a specific mascot and release its resources |
| `removeAll()` | Remove all mascots |
| `getState()` | Snapshot of all mascot states |
| `getCharacterIds()` | List of registered character IDs |
| `setPlatforms(elementsOrSelector)` | Replace the DOM elements exposed as interactive platforms |
| `on(event, listener)` | Subscribe to events (`"click"`, `"spawn"`, `"remove"`, `"error"`). Returns an unsubscribe function |
| `destroy()` | Tear down everything — cancels RAF, clears intervals, removes listeners, revokes blob URLs, removes DOM |
| `isDestroyed()` | Whether `destroy()` has been called |

#### `ShimejiEngineOptions`

```ts
interface ShimejiEngineOptions {
  frameDuration?: number;      // Animation unit in ms (default: 40)
  gravity?: number;            // Default gravity (default: 2)
  maxDeltaTime?: number;       // Frame delta clamp in ms (default: 100)
  workAreaClassName?: string;  // Deprecated compatibility option (no shared work area)
  mascotClassName?: string;    // CSS class for individual mascot elements
  platforms?: string | readonly HTMLElement[]; // Interactive DOM platforms
  random?: () => number;       // Custom RNG for deterministic behavior selection
}
```

#### `loadCharacter(url)`

Fetches and normalizes a character's `configuration.json` from a URL.

#### `normalizeCharacterSpec(source)`

Normalizes a `CharacterSpec` or legacy `CharacterSource` (with raw XML/JSON strings) into a fully parsed spec. Handles both pre-parsed and string-encoded `actions`, `behaviors`, and `sprites` fields.

#### `parseActionsXml(xml)` / `parseBehaviorsXml(xml)`

Parse Shimeji XML definitions into structured `ActionDefinition[]` / `BehaviorDefinition[]`. Supports both English tags (`Action`, `Behavior`, `Pose`) and Japanese tags (`動作`, `行動`, `ポーズ`).

### `@react-shimeji/react`

#### `<ShimejiContainer>`

Declarative bounding box that renders application children and absolutely positioned mascots together. It defaults to `position: relative` and `overflow: hidden`.

```tsx
<ShimejiContainer
  characters={specs}   // CharacterSpec[] — required
  count={15}           // number of mascots (default: 1)
  randomize            // random vs round-robin character selection (default: true)
  enabled              // toggle spawning on/off (default: true)
  platforms=".ledge"   // selector or React.RefObject<HTMLElement>[]
  options={...}        // ShimejiEngineOptions passed to the engine
  className="my-class" // applied to the bounding container
  style={{ height: 400 }}
>
  <YourContent />
</ShimejiContainer>
```

Handles registration, spawning, reconciliation on prop changes, and full cleanup on unmount.

Descendants can register themselves as platforms without lifting refs to the container:

```tsx
import { useShimejiPlatform } from "@react-shimeji/react";

function Ledge() {
  const platformRef = useShimejiPlatform<HTMLDivElement>();
  return <div ref={platformRef}>A walkable ledge</div>;
}
```

#### `useShimeji(containerRef, options?)`

Hook for imperative engine control on your own container element.

```ts
const ref = useRef<HTMLDivElement>(null);
const { engine, spawn, remove, removeAll } = useShimeji(ref, options);
```

Engine is created on mount and destroyed on unmount. Stable across rerenders.

## Character Format

Characters can be provided as a compiled `CharacterSpec`:

```ts
interface CharacterSpec {
  id: string;                    // Unique character identifier
  spritesheet: string | Blob;   // Atlas image (URL, data URI, or Blob)
  sprites: SpriteMap;           // Sprite regions keyed by image path
  actions: ActionDefinition[];  // Behavior action tree
  behaviors: BehaviorDefinition[];
}
```

Or as a legacy bundle with raw XML/JSON strings, which `normalizeCharacterSpec` will parse:

```ts
const character = normalizeCharacterSpec({
  id: "beemo",
  spritesheet: "/shimeji/beemo/spritesheet.png",
  sprites: '{ "/shime1.png": { "x": 0, "y": 0, "width": 128, "height": 128 } }',
  actions: "<Mascot>...</Mascot>",     // actions.xml content
  behaviors: "<Mascot>...</Mascot>",   // behaviors.xml content
});
```

Sprite maps support both atlas rectangles and standalone images:

```ts
sprites: {
  "/shime1.png": { x: 0, y: 0, width: 128, height: 128 },       // atlas crop
  "wave": { url: "/sprites/wave.png", width: 96, height: 96 },   // individual image
}
```

## Resource Management

The engine tracks every resource it creates:

- **Blob URLs** — spritesheet data URIs are converted to blob URLs via a ref-counted `SpriteLease` system. Each mascot holds a lease; removal releases the lease and revokes the URL. No zombie blobs.
- **Timers** — all `setInterval` handles are tracked and cleared on `destroy()`.
- **Event listeners** — every `addEventListener` is paired with a removal closure in a disposer array, flushed on `destroy()`.
- **Animation frames** — the `requestAnimationFrame` handle is cancelled on `destroy()`.
- **DOM nodes** — all independently mounted mascot elements are removed from the document.

`destroy()` is idempotent — calling it multiple times is safe.

## Development

```sh
git clone https://github.com/CarbonNeuron/react-shimeji.git
cd react-shimeji
npm install
npm test          # vitest — 7 tests
npm run typecheck # tsc --noEmit across all packages
npm run build     # tsup → ESM + CJS + declarations
```

## License

MIT
