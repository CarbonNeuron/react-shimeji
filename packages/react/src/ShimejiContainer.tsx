import { useEffect, useMemo, useRef } from "react";
import { useShimeji } from "./useShimeji";
import type { ShimejiContainerProps } from "./types";

/** Renders an empty mount-point anchor and reconciles its fixed mascots with React props. */
export function ShimejiContainer({
  characters,
  count = 1,
  randomize = true,
  enabled = true,
  options,
  platforms,
  className,
  style,
}: ShimejiContainerProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const { engine } = useShimeji(containerRef, options);
  const characterIds = useMemo(() => characters.map((character) => character.id).join("\0"), [characters]);

  useEffect(() => {
    if (!engine) return;
    if (typeof platforms === "string") {
      engine.setPlatforms(platforms);
      return;
    }
    if (platforms) {
      engine.setPlatforms(platforms.flatMap((platform) => platform.current ? [platform.current] : []));
      return;
    }
    engine.setPlatforms(options?.platforms ?? []);
  }, [engine, options?.platforms, platforms]);

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

  return <div ref={containerRef} className={className} aria-hidden="true" style={style} />;
}
