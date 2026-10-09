import { loadCharacter } from "./loader";
import type { CharacterSpec } from "./types";

export interface CharacterCdnEntry {
  id: string;
  name: string;
  group?: string;
  groupName?: string;
}

export interface CharacterCdn {
  readonly baseUrl: URL;
  list(): Promise<CharacterCdnEntry[]>;
  load(id: string): Promise<CharacterSpec>;
}

const validId = /^[a-z0-9-]+$/;

/** Loads a static character catalog and individual packs from a configurable CDN. */
export function createCharacterCdn(baseUrl: string | URL): CharacterCdn {
  const base = new URL(baseUrl);
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    throw new TypeError("Character CDN URL must use HTTP or HTTPS");
  }
  if (!base.pathname.endsWith("/")) base.pathname += "/";

  return {
    baseUrl: base,
    async list() {
      const url = new URL("index.json", base);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Unable to load character catalog '${url}': ${response.status} ${response.statusText}`);
      const entries: unknown = await response.json();
      if (!Array.isArray(entries) || entries.some((entry) =>
        !entry || typeof entry !== "object"
        || typeof entry.id !== "string" || !validId.test(entry.id)
        || typeof entry.name !== "string"
      )) {
        throw new TypeError(`Invalid character catalog at '${url}'`);
      }
      return entries as CharacterCdnEntry[];
    },
    async load(id) {
      if (!validId.test(id)) throw new TypeError(`Invalid character ID '${id}'`);
      const character = await loadCharacter(new URL(`characters/${id}.json`, base));
      if (character.id !== id) throw new TypeError(`Character '${id}' did not match the CDN response`);
      return character;
    },
  };
}
