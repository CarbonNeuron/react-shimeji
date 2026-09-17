import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { ShimejiPlatformContext } from "./ShimejiPlatformContext";
import { useShimeji } from "./useShimeji";
import type { ShimejiContainerProps } from "./types";

/** Renders a bounded container and reconciles its child platforms and mascots. */
export function ShimejiContainer({
  characters,
  count = 1,
  randomize = true,
  enabled = true,
  options,
  platforms,
  className,
  style,
  children,
}: ShimejiContainerProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const registeredPlatforms = useRef(new Set<HTMLElement>());
  const [platformVersion, platformsChanged] = useReducer((version: number) => version + 1, 0);
  const { engine } = useShimeji(containerRef, options);
  const characterIds = useMemo(() => characters.map((character) => character.id).join("\0"), [characters]);
  const registerPlatform = useCallback((element: HTMLElement) => {
    const added = !registeredPlatforms.current.has(element);
    registeredPlatforms.current.add(element);
    if (added) platformsChanged();
    let registered = true;
    return () => {
      if (!registered) return;
      registered = false;
      if (registeredPlatforms.current.delete(element)) platformsChanged();
    };
  }, []);
  const platformContext = useMemo(() => ({ registerPlatform }), [registerPlatform]);

  useEffect(() => {
    if (!engine) return;
    const source = typeof platforms === "string"
      ? platforms
      : platforms
        ? platforms.flatMap((platform) => platform.current ? [platform.current] : [])
        : options?.platforms ?? [];
    engine.setPlatforms(source, [...registeredPlatforms.current]);
  }, [engine, options?.platforms, platforms, platformVersion]);

  useEffect(() => {
    if (!engine) return;
    const nextIds = new Set(characters.map((character) => character.id));
    for (const registeredId of engine.getCharacterIds()) {
      if (!nextIds.has(registeredId)) engine.unregisterCharacter(registeredId, true);
    }
    for (const character of characters) engine.registerCharacter(character);
    if (!enabled || characters.length === 0) { engine.removeAll(); return; }

    const desiredCount = Math.max(0, Math.floor(count));
    const current = engine.getState();
    for (const mascot of current.slice(desiredCount)) engine.remove(mascot.id);
    const remaining = engine.getState().length;
    for (let index = remaining; index < desiredCount; index += 1) {
      const characterIndex = randomize ? Math.floor(Math.random() * characters.length) : index % characters.length;
      const character = characters[characterIndex];
      if (character) engine.spawn(character.id);
    }

    // When a mascot exits or breeds away, spawn a random replacement to maintain count
    const unsubRemove = engine.on("remove", () => {
      if (characters.length === 0) return;
      const liveCount = engine.getState().length;
      if (liveCount < desiredCount) {
        const character = characters[Math.floor(Math.random() * characters.length)];
        if (character) engine.spawn(character.id);
      }
    });

    // Cap breed spawns — remove excess when mascots multiply beyond desired count
    const unsubSpawn = engine.on("spawn", () => {
      const live = engine.getState();
      if (live.length > desiredCount) {
        for (const mascot of live.slice(desiredCount)) engine.remove(mascot.id);
      }
    });

    return () => { unsubRemove(); unsubSpawn(); };
  }, [engine, characterIds, characters, count, enabled, randomize]);

  return (
    <ShimejiPlatformContext.Provider value={platformContext}>
      <div
        ref={containerRef}
        className={className}
        style={{ position: "relative", overflowX: "clip", ...style }}
      >
        {children}
      </div>
    </ShimejiPlatformContext.Provider>
  );
}
