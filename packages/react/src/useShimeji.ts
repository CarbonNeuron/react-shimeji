import { ShimejiEngine, type ShimejiEngineOptions, type SpawnOptions } from "@react-shimeji/core";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { UseShimejiResult } from "./types";

/** Creates one Shimeji engine for a DOM ref and destroys it when the component unmounts. */
export function useShimeji(containerRef: RefObject<HTMLElement>, options: ShimejiEngineOptions = {}): UseShimejiResult {
  const optionsRef = useRef(options);
  const engineRef = useRef<ShimejiEngine | null>(null);
  const [engine, setEngine] = useState<ShimejiEngine | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const instance = new ShimejiEngine(container, optionsRef.current);
    engineRef.current = instance;
    setEngine(instance);
    return () => {
      engineRef.current = null;
      instance.destroy();
    };
  }, [containerRef]);

  const spawn = useCallback((characterId: string, position?: SpawnOptions) => {
    const current = engineRef.current;
    return current ? current.spawn(characterId, position) : undefined;
  }, []);
  const remove = useCallback((mascotId: string) => engineRef.current?.remove(mascotId) ?? false, []);
  const removeAll = useCallback(() => { engineRef.current?.removeAll(); }, []);
  return { engine, spawn, remove, removeAll };
}
