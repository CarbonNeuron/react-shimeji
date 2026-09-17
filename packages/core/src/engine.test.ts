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

  it("reads each platform once per frame and lands falling mascots on its top edge", () => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frame = callback; return 7; }));
    const platform = document.createElement("div");
    platform.className = "platform";
    document.body.append(platform);
    const platformRectangle = vi.spyOn(platform, "getBoundingClientRect").mockReturnValue({
      left: 110, top: 220, width: 200, height: 40,
    } as DOMRect);
    const host = document.createElement("div");
    document.body.append(host);
    const engine = new ShimejiEngine(host, { platforms: ".platform" });
    const workArea = host.querySelector<HTMLElement>("[data-react-shimeji-work-area]")!;
    vi.spyOn(workArea, "getBoundingClientRect").mockReturnValue({
      left: 10, top: 20, width: 500, height: 400,
    } as DOMRect);
    engine.registerCharacter(spec);
    engine.spawn("test", { x: 150, y: 190, vy: 20 });
    engine.spawn("test", { x: 180, y: 190, vy: 20 });
    platformRectangle.mockClear();

    frame?.(40);

    expect(platformRectangle).toHaveBeenCalledOnce();
    expect(engine.getState().map(({ y }) => y)).toEqual([200, 200]);
    engine.destroy();
  });

  it("switches a mascot to falling when it walks past a platform edge", () => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frame = callback; return 7; }));
    const platform = document.createElement("div");
    document.body.append(platform);
    vi.spyOn(platform, "getBoundingClientRect").mockReturnValue({
      left: 100, top: 200, width: 200, height: 40,
    } as DOMRect);
    const host = document.createElement("div");
    document.body.append(host);
    const engine = new ShimejiEngine(host, { platforms: [platform] });
    const workArea = host.querySelector<HTMLElement>("[data-react-shimeji-work-area]")!;
    vi.spyOn(workArea, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 500, height: 400,
    } as DOMRect);
    engine.registerCharacter({
      ...spec,
      actions: [
        ...spec.actions,
        { type: "Animate", name: "Walk", duration: 10, animations: [{ poses: [{ sprite: "/shime1.png", anchor: { x: 16, y: 32 }, velocity: { x: 10, y: 0 }, duration: 10 }] }] },
      ],
      behaviors: [
        ...spec.behaviors,
        { type: "Behavior", name: "Walk", frequency: 1, conditions: [], nextBehaviors: [], groupIndex: 0, hidden: false },
      ],
    });
    engine.spawn("test", { x: 295, y: 200, behaviorName: "Walk" });

    frame?.(40);

    expect(engine.getState()[0]).toMatchObject({ x: 305, y: 200, behaviorName: "Fall" });
    engine.destroy();
  });
});
