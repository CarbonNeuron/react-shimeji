// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShimejiEngine } from "./engine";
import type { ActionDefinition, CharacterSpec } from "./types";

const spec: CharacterSpec = {
  id: "test",
  spritesheet: "data:image/png;base64,AA==",
  sprites: { "/shime1.png": { x: 0, y: 0, width: 32, height: 32 } },
  actions: [{ type: "Embedded", name: "Fall", embedType: "Fall", animations: [{ poses: [{ sprite: "/shime1.png", anchor: { x: 16, y: 32 }, velocity: { x: 0, y: 0 }, duration: 1 }] }] }],
  behaviors: [{ type: "Behavior", name: "Fall", frequency: 1, conditions: [], nextBehaviors: [], groupIndex: 0, hidden: false }],
};

function behavior(name: string) {
  return { type: "Behavior" as const, name, frequency: 1, conditions: [], nextBehaviors: [], groupIndex: 0, hidden: false };
}

function animatedAction(name: string, velocity: { x: number; y: number }, borderType: "Floor" | "Wall" = "Floor"): ActionDefinition {
  return {
    type: "Animate",
    name,
    borderType,
    duration: 10,
    animations: [{ poses: [{ sprite: "/shime1.png", anchor: { x: 16, y: 32 }, velocity, duration: 10 }] }],
  };
}

function withBehavior(name: string, action: ActionDefinition): CharacterSpec {
  return { ...spec, actions: [...spec.actions, action], behaviors: [...spec.behaviors, behavior(name)] };
}

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
    const mascot = host.querySelector<HTMLElement>(`[data-shimeji-id="${id}"]`)!;
    expect(mascot.parentElement).toBe(host);
    expect(mascot.style.position).toBe("fixed");
    expect(mascot.style.pointerEvents).toBe("none");
    expect(mascot.style.zIndex).toBe("9999");
    expect(mascot.firstElementChild).toHaveProperty("style.pointerEvents", "auto");
    expect(host.querySelector("[data-react-shimeji-work-area]")).toBeNull();
    expect(host.style.position).toBe("");
    engine.remove(id);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
    engine.destroy();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(7);
    expect(vi.getTimerCount()).toBe(0);
    expect(host.querySelector("[data-react-shimeji-work-area]")).toBeNull();
    expect(engine.isDestroyed()).toBe(true);
  });

  it("spawns at the top of the viewport when y is omitted", () => {
    const host = document.createElement("div");
    document.body.append(host);
    vi.stubGlobal("innerWidth", 400);
    vi.stubGlobal("innerHeight", 300);
    const engine = new ShimejiEngine(host, { random: () => 0.75 });
    engine.registerCharacter(spec);

    engine.spawn("test");

    expect(engine.getState()[0]).toMatchObject({ x: 300, y: 0 });
    engine.destroy();
  });

  it("reads each platform once per frame and lands falling mascots on its top edge", () => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frame = callback; return 7; }));
    const platform = document.createElement("div");
    platform.className = "platform";
    document.body.append(platform);
    const platformRectangle = vi.spyOn(platform, "getBoundingClientRect").mockReturnValue({
      left: 100, top: 200, width: 200, height: 40,
    } as DOMRect);
    const host = document.createElement("div");
    document.body.append(host);
    const engine = new ShimejiEngine(host, { platforms: ".platform" });
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
    engine.registerCharacter({
      ...spec,
      actions: [
        ...spec.actions,
        { type: "Animate", name: "Walk", duration: 10, animations: [{ poses: [{ sprite: "/shime1.png", anchor: { x: 16, y: 32 }, velocity: { x: 24, y: 0 }, duration: 10 }] }] },
      ],
      behaviors: [
        ...spec.behaviors,
        { type: "Behavior", name: "Walk", frequency: 1, conditions: [], nextBehaviors: [], groupIndex: 0, hidden: false },
      ],
    });
    engine.spawn("test", { x: 295, y: 200, behaviorName: "Walk" });

    frame?.(40);

    expect(engine.getState()[0]).toMatchObject({ x: 319, y: 200, behaviorName: "Fall" });
    engine.destroy();
  });

  it("keeps a stationary sitting mascot on a platform", () => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frame = callback; return 7; }));
    const platform = document.createElement("div");
    document.body.append(platform);
    vi.spyOn(platform, "getBoundingClientRect").mockReturnValue({ left: 100, top: 200, width: 200, height: 40 } as DOMRect);
    const host = document.createElement("div");
    document.body.append(host);
    const engine = new ShimejiEngine(host, { platforms: [platform] });
    engine.registerCharacter(withBehavior("Sit", animatedAction("Sit", { x: 0, y: 0 })));
    engine.spawn("test", { x: 150, y: 200, behaviorName: "Sit" });

    frame?.(40);

    expect(engine.getState()[0]).toMatchObject({ x: 150, y: 200, behaviorName: "Sit" });
    engine.destroy();
  });

  it("allows a dangling-legs animation to move below a platform top", () => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frame = callback; return 7; }));
    const platform = document.createElement("div");
    document.body.append(platform);
    vi.spyOn(platform, "getBoundingClientRect").mockReturnValue({ left: 100, top: 200, width: 200, height: 4 } as DOMRect);
    const host = document.createElement("div");
    document.body.append(host);
    const engine = new ShimejiEngine(host, { platforms: [platform] });
    engine.registerCharacter(withBehavior("SitWhileDanglingLegs", animatedAction("SitWhileDanglingLegs", { x: 0, y: 8 })));
    engine.spawn("test", { x: 150, y: 200, behaviorName: "SitWhileDanglingLegs" });

    frame?.(40);

    expect(engine.getState()[0]).toMatchObject({ x: 150, y: 208, behaviorName: "SitWhileDanglingLegs" });
    engine.destroy();
  });

  it.each([
    ["left", 100, -8, 92],
    ["right", 300, 8, 308],
  ] as const)("allows sitting just past the %s platform edge", (_side, startX, velocityX, expectedX) => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frame = callback; return 7; }));
    const platform = document.createElement("div");
    document.body.append(platform);
    vi.spyOn(platform, "getBoundingClientRect").mockReturnValue({ left: 100, top: 200, width: 200, height: 40 } as DOMRect);
    const host = document.createElement("div");
    document.body.append(host);
    const engine = new ShimejiEngine(host, { platforms: [platform] });
    const name = `SitOnThe${_side === "left" ? "Left" : "Right"}EdgeOfIE`;
    engine.registerCharacter(withBehavior(name, animatedAction(name, { x: velocityX, y: 0 })));
    engine.spawn("test", { x: startX, y: 200, behaviorName: name });

    frame?.(40);

    expect(engine.getState()[0]).toMatchObject({ x: expectedX, y: 200, behaviorName: name });
    engine.destroy();
  });

  it("keeps a mascot climbing a platform wall in its climbing behavior", () => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frame = callback; return 7; }));
    const platform = document.createElement("div");
    document.body.append(platform);
    vi.spyOn(platform, "getBoundingClientRect").mockReturnValue({ left: 100, top: 200, width: 200, height: 40 } as DOMRect);
    const host = document.createElement("div");
    document.body.append(host);
    const engine = new ShimejiEngine(host, { platforms: [platform] });
    engine.registerCharacter(withBehavior("ClimbIEWall", animatedAction("ClimbIEWall", { x: 0, y: 8 }, "Wall")));
    engine.spawn("test", { x: 100, y: 200, behaviorName: "ClimbIEWall" });

    frame?.(40);

    expect(engine.getState()[0]).toMatchObject({ x: 100, y: 208, behaviorName: "ClimbIEWall" });
    engine.destroy();
  });
});
