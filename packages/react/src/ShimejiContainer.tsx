import { useEffect, useMemo, useRef } from "react";
import { useShimeji } from "./useShimeji";
import type { ShimejiContainerProps } from "./types";

/** Renders a full-viewport overlay and reconciles its mascots with React props. */
export function ShimejiContainer({
  characters,
  count = 1,
  randomize = true,
  enabled = true,
  options,
  className,
  style,
}: ShimejiContainerProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const { engine } = useShimeji(containerRef, options);
  const characterIds = useMemo(() => characters.map((character) => character.id).join("\0"), [characters]);

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
  }, [engine, characterIds, characters, count, enabled, randomize]);

  return (
    <div
      ref={containerRef}
      className={className}
      aria-hidden="true"
      style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", overflow: "hidden", pointerEvents: "none", zIndex: 2147483643, ...style }}
    />
  );
}
