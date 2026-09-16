import type { CharacterSpec, ShimejiEngine, ShimejiEngineOptions, SpawnOptions } from "@react-shimeji/core";
import type { CSSProperties } from "react";

/** Value returned by {@link useShimeji}. */
export interface UseShimejiResult {
  /** Stable engine instance, or null before the mount effect runs. */
  engine: ShimejiEngine | null;
  /** Spawns one registered character and returns its mascot id. */
  spawn(characterId: string, position?: SpawnOptions): string | undefined;
  /** Removes one mascot by id. */
  remove(mascotId: string): boolean;
  /** Removes every mascot managed by the hook. */
  removeAll(): void;
}

/** Props accepted by the full-viewport {@link ShimejiContainer}. */
export interface ShimejiContainerProps {
  /** Parsed character specifications available to the component. */
  characters: readonly CharacterSpec[];
  /** Desired total number of live mascots. Defaults to one. */
  count?: number;
  /** Chooses character types randomly instead of round-robin. Defaults to true. */
  randomize?: boolean;
  /** Enables spawning. Disabling removes all current mascots. */
  enabled?: boolean;
  /** Options used when the engine is first mounted. */
  options?: ShimejiEngineOptions;
  /** Optional class applied to the full-viewport host. */
  className?: string;
  /** Optional style overrides for the host. */
  style?: CSSProperties;
}
