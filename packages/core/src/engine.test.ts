// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShimejiEngine } from "./engine";
import type { CharacterSpec } from "./types";

const spec: CharacterSpec = {
  id: "test",
  spritesheet: "data:image/png;base64,AA==",
  sprites: { "/shime1.png": { x: 0, y: 0, width: 32, height: 32 } },
  actions: [{ type: "Embedded", name: "Fall", embedType: "Fall", animations: [{ poses: [{ sprite: "/shime1.png", anchor: { x: 16, y: 32 }, velocity: { x: 0, y: 0 }, duration: 1 }] }] }],
  behaviors: [{ type: "Behavior", name: "Fall", frequency: 1, conditions: [], nextBehaviors: [], groupIndex: 0, hidden: false }],
};

describe("ShimejiEngine lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 7));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:test") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

  it("spawns, removes, and fully destroys owned resources", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const engine = new ShimejiEngine(host);
    engine.registerCharacter(spec);
    const id = engine.spawn("test", { x: 20, y: 30 });
    expect(engine.getState()).toMatchObject([{ id, characterId: "test", x: 20, y: 30 }]);
    expect(host.querySelector(`[data-shimeji-id="${id}"]`)).not.toBeNull();
    engine.remove(id);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
    engine.destroy();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(7);
    expect(vi.getTimerCount()).toBe(0);
    expect(host.querySelector("[data-react-shimeji-work-area]")).toBeNull();
    expect(engine.isDestroyed()).toBe(true);
  });
});
