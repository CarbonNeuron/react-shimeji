import { afterEach, describe, expect, it, vi } from "vitest";
import { createCharacterCdn } from "./cdn";
import type { CharacterSpec } from "./types";

const spec: CharacterSpec = {
  id: "sample-pack",
  spritesheet: "data:image/png;base64,AA==",
  sprites: {},
  actions: [],
  behaviors: [],
};

afterEach(() => vi.unstubAllGlobals());

describe("character CDN", () => {
  it("loads the index and one character from a configured base path", async () => {
    const fetchMock = vi.fn(async (url: URL) => Response.json(
      url.pathname.endsWith("index.json")
        ? [{ id: "sample-pack", name: "Sample" }]
        : spec,
    ));
    vi.stubGlobal("fetch", fetchMock);
    const cdn = createCharacterCdn("https://example.test/shimeji");

    expect(await cdn.list()).toEqual([{ id: "sample-pack", name: "Sample" }]);
    expect(await cdn.load("sample-pack")).toEqual(spec);
    expect(fetchMock.mock.calls.map(([url]) => url.toString())).toEqual([
      "https://example.test/shimeji/index.json",
      "https://example.test/shimeji/characters/sample-pack.json",
    ]);
  });

  it("rejects IDs that could escape the character directory", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(createCharacterCdn("https://example.test/").load("../other"))
      .rejects.toThrow("Invalid character ID");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
