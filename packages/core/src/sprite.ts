import type { CharacterSpec, IndividualSprite, SpriteRectangle } from "./types";

/** A resolved image and optional atlas crop for one sprite frame. */
export interface ResolvedSprite {
  /** Browser-loadable image URL. */
  url: string;
  /** Optional atlas crop. */
  rectangle?: SpriteRectangle;
}

/** A per-mascot spritesheet resource whose temporary URL can be released. */
export interface SpriteLease {
  /** URL used to render atlas-backed frames. */
  url: string;
  /** Releases any object URL owned by this lease. */
  release(): void;
}

function dataUriToBlob(source: string): Blob {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(source);
  if (!match) throw new TypeError("Invalid image data URI");
  const mimeType = match[1] ?? "application/octet-stream";
  const encoded = match[3] ?? "";
  const binary = match[2] ? atob(encoded) : decodeURIComponent(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType });
}

/** Owns temporary sprite URLs and resolves atlas or individual image frames. */
export class SpriteManager {
  private readonly leases = new Set<SpriteLease>();

  /** Creates a separately releasable spritesheet lease for a mascot. */
  public acquire(source: string | Blob): SpriteLease {
    let url = typeof source === "string" ? source : "";
    let owned = false;
    if (typeof URL.createObjectURL === "function" && (typeof source !== "string" || source.startsWith("data:image"))) {
      try {
        url = URL.createObjectURL(typeof source === "string" ? dataUriToBlob(source) : source);
        owned = true;
      } catch {
        if (typeof source !== "string") throw new Error("The current environment cannot create a URL for the spritesheet Blob");
      }
    }
    let released = false;
    const lease: SpriteLease = {
      url,
      release: () => {
        if (released) return;
        released = true;
        this.leases.delete(lease);
        if (owned) URL.revokeObjectURL(url);
      },
    };
    this.leases.add(lease);
    return lease;
  }

  /** Resolves a sprite key using a lease and the character's sprite map. */
  public resolve(spec: CharacterSpec, lease: SpriteLease, spriteName: string): ResolvedSprite | undefined {
    const key = Object.keys(spec.sprites).find((candidate) => candidate.toLowerCase() === spriteName.toLowerCase());
    const sprite = key ? spec.sprites[key] : undefined;
    if (typeof sprite === "string") return { url: sprite };
    if (sprite && "url" in sprite && typeof sprite.url === "string" && !("x" in sprite)) return { url: sprite.url };
    if (sprite && "x" in sprite) return { url: sprite.url ?? lease.url, rectangle: sprite };
    if (/^(?:data:|blob:|https?:|\/)/.test(spriteName)) return { url: spriteName };
    return undefined;
  }

  /** Revokes every object URL that has not already been released. */
  public destroy(): void {
    for (const lease of [...this.leases]) lease.release();
  }
}

/** Returns whether a sprite definition is a standalone image object. */
export function isIndividualSprite(sprite: SpriteRectangle | IndividualSprite | string): sprite is IndividualSprite {
  return typeof sprite === "object" && "url" in sprite && !("x" in sprite);
}
