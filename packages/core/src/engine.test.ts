// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BehaviorController } from "./behavior";
import { ShimejiEngine } from "./engine";
import { Mascot } from "./mascot";
import type { PlatformRectangle } from "./platform";
import type { ActionDefinition, CharacterSpec, MascotEnvironment } from "./types";

const spec: CharacterSpec = {
  id: "test",
  spritesheet: "data:image/png;base64,AA==",
  sprites: { "/shime1.png": { x: 0, y: 0, width: 32, height: 32 } },
  actions: [{ type: "Embedded", name: "Fall", embedType: "Fall", initialVy: 20, animations: [{ poses: [{ sprite: "/shime1.png", anchor: { x: 16, y: 32 }, velocity: { x: 0, y: 0 }, duration: 1 }] }] }],
  behaviors: [{ type: "Behavior", name: "Fall", frequency: 1, conditions: [], nextBehaviors: [], groupIndex: 0, hidden: false }],
};

function behavior(name: string) {
  return { type: "Behavior" as const, name, frequency: 1, conditions: [], nextBehaviors: [], groupIndex: 0, hidden: false };
}

function animatedAction(name: string, velocity: { x: number; y: number }, borderType: "Floor" | "Wall" | null = "Floor"): ActionDefinition {
  return {
    type: "Animate",
    name,
    ...(borderType && { borderType }),
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
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => window.innerWidth);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => window.innerHeight);
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:test") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

  it("spawns, removes, and fully destroys owned resources", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const engine = new ShimejiEngine(host);
    engine.registerCharacter(spec);
    const id = engine.spawn("test", { x: 20, y: 30 });
    expect(engine.getState()).toMatchObject([{ id, characterId: "test", x: 20, y: 30 }]);
    const mascot = host.querySelector<HTMLElement>(`[data-shimeji-id="${id}"]`)!;
    expect(mascot.parentElement).toBe(host);
    expect(mascot.style.position).toBe("absolute");
    expect(mascot.style.pointerEvents).toBe("none");
    expect(mascot.style.zIndex).toBe("9999");
    expect(mascot.firstElementChild).toHaveProperty("style.pointerEvents", "auto");
    expect(host.querySelector("[data-react-shimeji-work-area]")).toBeNull();
    expect(host.style.position).toBe("relative");
    expect(host.style.overflowX).toBe("clip");
    engine.remove(id);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
    engine.destroy();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(7);
    expect(vi.getTimerCount()).toBe(0);
    expect(host.querySelector("[data-react-shimeji-work-area]")).toBeNull();
    expect(engine.isDestroyed()).toBe(true);
    expect(host.style.position).toBe("");
    expect(host.style.overflow).toBe("");
  });

  it("spawns within the container dimensions when coordinates are omitted", () => {
    const host = document.createElement("div");
    Object.defineProperties(host, {
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
    });
    document.body.append(host);
    const engine = new ShimejiEngine(host, { random: () => 0.75 });
    engine.registerCharacter(spec);

    engine.spawn("test");

    expect(engine.getState()[0]).toMatchObject({ x: 300, y: 2 });
    engine.destroy();
  });

  it("keeps an implicit spawn clear of the side wall and falling", () => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frame = callback; return 7; }));
    const host = document.createElement("div");
    Object.defineProperties(host, {
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
    });
    document.body.append(host);
    const engine = new ShimejiEngine(host, { random: () => 0 });
    engine.registerCharacter(spec);

    engine.spawn("test");
    expect(engine.getState()[0]).toMatchObject({ x: 2, y: 2, behaviorName: "Fall" });

    frame?.(40);

    expect(engine.getState()[0]).toMatchObject({ x: 2, y: 22, behaviorName: "Fall" });
    for (let timestamp = 80; timestamp <= 800; timestamp += 40) frame?.(timestamp);
    expect(engine.getState()[0]).toMatchObject({ x: 2, y: 300 });
    engine.destroy();
  });

  it("forces the localized Fall behavior for an implicit spawn", () => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frame = callback; return 7; }));
    const host = document.createElement("div");
    Object.defineProperties(host, {
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
    });
    document.body.append(host);
    const engine = new ShimejiEngine(host, { random: () => 0.5 });
    engine.registerCharacter({
      ...spec,
      actions: [{ ...spec.actions[0]!, name: "落下する" }],
      behaviors: [behavior("Stand"), { ...behavior("落下する"), frequency: 0 }],
    });

    engine.spawn("test");
    frame?.(40);

    expect(engine.getState()[0]).toMatchObject({ y: 22, behaviorName: "落下する" });
    engine.destroy();
  });

  it("mirrors non-centered image anchors like Shimeji-ee", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const engine = new ShimejiEngine(host);
    engine.registerCharacter({
      ...spec,
      actions: [{
        type: "Embedded", name: "Fall", embedType: "Fall",
        animations: [{ poses: [{ sprite: "/shime1.png", anchor: { x: 8, y: 32 }, velocity: { x: 0, y: 0 }, duration: 1 }] }],
      }],
    });
    const id = engine.spawn("test", { x: 20, y: 40, lookRight: true });
    expect(host.querySelector<HTMLElement>(`[data-shimeji-id="${id}"]`)?.style.transform).toBe("translate3d(-4px, 8px, 0)");
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
    host.append(platform);
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

  it("turns grounded mascots around before they walk through each other", () => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frame = callback; return 7; }));
    const host = document.createElement("div");
    Object.defineProperties(host, {
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
    });
    document.body.append(host);
    const engine = new ShimejiEngine(host);
    engine.registerCharacter({
      ...spec,
      actions: [...spec.actions, animatedAction("Walk", { x: -8, y: 0 })],
      behaviors: [{ ...spec.behaviors[0]!, frequency: 0 }, behavior("Walk")],
    });
    engine.spawn("test", { x: 100, y: 300, lookRight: true, behaviorName: "Walk" });
    engine.spawn("test", { x: 140, y: 300, lookRight: false, behaviorName: "Walk" });

    frame?.(40);

    expect(engine.getState()).toMatchObject([
      { x: 100, y: 300, lookRight: false, behaviorName: "Walk" },
      { x: 140, y: 300, lookRight: true, behaviorName: "Walk" },
    ]);

    frame?.(80);

    expect(engine.getState()).toMatchObject([
      { x: 92, y: 300, lookRight: false, behaviorName: "Walk" },
      { x: 148, y: 300, lookRight: true, behaviorName: "Walk" },
    ]);
    engine.destroy();
  });

  it("separates grounded mascots that spawn at the same position", () => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frame = callback; return 7; }));
    const host = document.createElement("div");
    Object.defineProperties(host, {
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
    });
    document.body.append(host);
    const engine = new ShimejiEngine(host);
    engine.registerCharacter({
      ...spec,
      actions: [...spec.actions, animatedAction("Walk", { x: -8, y: 0 })],
      behaviors: [{ ...spec.behaviors[0]!, frequency: 0 }, behavior("Walk")],
    });
    engine.spawn("test", { x: 100, y: 300, behaviorName: "Walk" });
    engine.spawn("test", { x: 100, y: 300, behaviorName: "Walk" });

    const distances: number[] = [];
    for (let timestamp = 40; timestamp <= 240; timestamp += 40) {
      frame?.(timestamp);
      const [first, second] = engine.getState();
      distances.push(Math.abs(second!.x - first!.x));
      expect([first!.lookRight, second!.lookRight]).toEqual([false, true]);
    }

    expect(distances).toEqual([8, 24, 40, 56, 72, 88]);
    engine.destroy();
  });

  it("does not block a falling mascot when it overlaps a sibling", () => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frame = callback; return 7; }));
    const host = document.createElement("div");
    Object.defineProperties(host, {
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
    });
    document.body.append(host);
    const engine = new ShimejiEngine(host);
    engine.registerCharacter({
      ...spec,
      actions: [
        { ...spec.actions[0]!, initialVx: 20, initialVy: 20 },
        animatedAction("Sit", { x: 0, y: 0 }),
      ],
      behaviors: [spec.behaviors[0]!, behavior("Sit")],
    });
    engine.spawn("test", { x: 100, y: 250, behaviorName: "Fall" });
    engine.spawn("test", { x: 128, y: 300, behaviorName: "Sit" });

    frame?.(40);

    expect(engine.getState()[0]).toMatchObject({ x: 119, y: 270, lookRight: true, behaviorName: "Fall" });
    engine.destroy();
  });

  it("selects an IE jump from the floor when a platform is nearby", () => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frame = callback; return 7; }));
    const platform = document.createElement("div");
    vi.spyOn(platform, "getBoundingClientRect").mockReturnValue({
      left: 100, top: 120, width: 100, height: 20,
    } as DOMRect);
    const host = document.createElement("div");
    Object.defineProperties(host, {
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
    });
    host.append(platform);
    document.body.append(host);

    const selectedPlatforms: Array<PlatformRectangle | undefined> = [];
    const mascotPrototype = Mascot.prototype as unknown as {
      selectActivePlatform(platforms: readonly PlatformRectangle[]): PlatformRectangle | undefined;
    };
    const selectActivePlatform = mascotPrototype.selectActivePlatform;
    vi.spyOn(mascotPrototype, "selectActivePlatform").mockImplementation(function (this: Mascot, platforms) {
      const selected = selectActivePlatform.call(this, platforms);
      selectedPlatforms.push(selected);
      return selected;
    });
    const selectionEnvironments: MascotEnvironment[] = [];
    const selectNext = BehaviorController.prototype.selectNext;
    vi.spyOn(BehaviorController.prototype, "selectNext").mockImplementation(function (this: BehaviorController, environment) {
      selectionEnvironments.push(environment);
      return selectNext.call(this, environment);
    });
    const engine = new ShimejiEngine(host, { platforms: [platform], random: () => 0 });
    engine.registerCharacter({
      ...spec,
      actions: [
        ...spec.actions,
        { type: "Stay", name: "Wait", borderType: "Floor", duration: 1 },
        {
          type: "Embedded", name: "JumpToIE", embedType: "Jump", velocity: 20,
          targetX: "${mascot.environment.activeIE.left}",
          targetY: "${mascot.environment.activeIE.bottom + 64}",
        },
      ],
      behaviors: [
        { ...spec.behaviors[0]!, frequency: 0 },
        { ...behavior("Wait"), frequency: 0 },
        {
          ...behavior("JumpToIE"),
          conditions: [
            "#{mascot.environment.floor.isOn(mascot.anchor)}",
            "#{mascot.environment.activeIE.visible}",
            "#{mascot.anchor.x < mascot.environment.activeIE.left}",
          ],
        },
      ],
    });
    engine.spawn("test", { x: 50, y: 300, behaviorName: "Wait" });

    for (let timestamp = 40; timestamp <= 400 && engine.getState()[0]?.behaviorName !== "JumpToIE"; timestamp += 40) frame?.(timestamp);

    const activeIE = selectionEnvironments.at(-1)?.mascot.environment.activeIE;
    expect(selectedPlatforms.some((selected) => selected?.element === platform)).toBe(true);
    expect(activeIE).toMatchObject({ x: 100, y: 120, width: 100, height: 20, visible: true });
    expect(activeIE?.topBorder.isOn({ x: 150, y: 120 })).toBe(true);
    expect(activeIE?.leftBorder.isOn({ x: 100, y: 130 })).toBe(true);
    expect(activeIE?.rightBorder.isOn({ x: 200, y: 130 })).toBe(true);
    expect(activeIE?.bottomBorder.isOn({ x: 150, y: 140 })).toBe(true);
    expect(engine.getState()[0]?.behaviorName).toBe("JumpToIE");
    frame?.(80);
    expect(engine.getState()[0]).toMatchObject({ x: 57, y: 282 });
    engine.destroy();
  });

  it("lands on fractional CSS-pixel platform edges", () => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frame = callback; return 7; }));
    const platform = document.createElement("div");
    platform.dataset.shimejiPlatform = "";
    vi.spyOn(platform, "getBoundingClientRect").mockReturnValue({
      left: 100.9999995, top: 200.9999995, width: 200, height: 40,
    } as DOMRect);
    const host = document.createElement("div");
    host.append(platform);
    document.body.append(host);
    const engine = new ShimejiEngine(host, { platforms: "[data-shimeji-platform]" });
    engine.registerCharacter(spec);
    engine.spawn("test", { x: 150, y: 190, vy: 20 });

    frame?.(40);

    expect(engine.getState()[0]).toMatchObject({ x: 150, y: 200 });
    engine.destroy();
  });

  it("converts pointer and platform geometry to container-relative coordinates", () => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frame = callback; return 7; }));
    const host = document.createElement("div");
    Object.defineProperties(host, {
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
    });
    vi.spyOn(host, "getBoundingClientRect").mockReturnValue({
      left: 40, top: 20, width: 400, height: 300,
    } as DOMRect);
    const platform = document.createElement("div");
    platform.className = "platform";
    vi.spyOn(platform, "getBoundingClientRect").mockReturnValue({
      left: 140, top: 220, width: 200, height: 40,
    } as DOMRect);
    const outside = document.createElement("div");
    outside.className = "platform";
    const outsideRectangle = vi.spyOn(outside, "getBoundingClientRect");
    host.append(platform);
    document.body.append(host, outside);
    const engine = new ShimejiEngine(host, { platforms: ".platform" });
    engine.registerCharacter({
      ...spec,
      actions: [
        ...spec.actions,
        { type: "Embedded", name: "Follow", embedType: "Jump", targetX: "mascot.environment.cursor.x", targetY: 50, velocity: 200 },
      ],
      behaviors: [...spec.behaviors, behavior("Follow")],
    });
    document.dispatchEvent(new MouseEvent("pointermove", { clientX: 140, clientY: 70 }));
    engine.spawn("test", { x: 0, y: 50, behaviorName: "Follow" });

    frame?.(40);

    expect(engine.getState()[0]).toMatchObject({ x: 100, y: 50 });
    expect(outsideRectangle).not.toHaveBeenCalled();
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
    host.append(platform);
    const engine = new ShimejiEngine(host, { platforms: [platform], random: () => 0 });
    engine.registerCharacter({
      ...spec,
      actions: [
        ...spec.actions,
        { type: "Animate", name: "Walk", borderType: "Floor", duration: 10, animations: [{ poses: [{ sprite: "/shime1.png", anchor: { x: 16, y: 32 }, velocity: { x: 24, y: 0 }, duration: 10 }] }] },
      ],
      behaviors: [
        ...spec.behaviors,
        { type: "Behavior", name: "Walk", frequency: 1, conditions: [], nextBehaviors: [], groupIndex: 0, hidden: false },
      ],
    });
    engine.spawn("test", { x: 295, y: 200, behaviorName: "Walk" });

    frame?.(40);

    expect(engine.getState()[0]).toMatchObject({ x: 319, y: 200, behaviorName: "Walk" });
    frame?.(80);
    expect(engine.getState()[0]).toMatchObject({ x: 319, y: 200, behaviorName: "Fall" });
    engine.destroy();
  });

  it("selects an IE wall behavior when a mascot crosses a platform edge", () => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frame = callback; return 7; }));
    const platform = document.createElement("div");
    vi.spyOn(platform, "getBoundingClientRect").mockReturnValue({
      left: 100, top: 200, width: 200, height: 40,
    } as DOMRect);
    const host = document.createElement("div");
    host.append(platform);
    document.body.append(host);
    const engine = new ShimejiEngine(host, { platforms: [platform], random: () => 0 });
    engine.registerCharacter({
      ...spec,
      actions: [
        ...spec.actions,
        animatedAction("Walk", { x: 24, y: 0 }),
        animatedAction("ClimbIEWall", { x: 0, y: 8 }, "Wall"),
      ],
      behaviors: [
        { ...spec.behaviors[0]!, frequency: 0 },
        { ...behavior("Walk"), frequency: 0 },
        {
          ...behavior("ClimbIEWall"),
          conditions: ["#{mascot.lookRight ? mascot.environment.activeIE.leftBorder.isOn(mascot.anchor) : mascot.environment.activeIE.rightBorder.isOn(mascot.anchor)}"],
        },
      ],
    });
    engine.spawn("test", { x: 295, y: 200, lookRight: false, behaviorName: "Walk" });

    frame?.(40);
    expect(engine.getState()[0]).toMatchObject({ x: 319, y: 200, behaviorName: "Walk" });

    frame?.(80);
    expect(engine.getState()[0]).toMatchObject({ x: 300, y: 200, behaviorName: "ClimbIEWall" });

    frame?.(120);
    expect(engine.getState()[0]).toMatchObject({ x: 300, y: 208, behaviorName: "ClimbIEWall" });
    engine.destroy();
  });

  it("rolls only among applicable IE behaviors before the full pool at a platform edge", () => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frame = callback; return 7; }));
    const platform = document.createElement("div");
    vi.spyOn(platform, "getBoundingClientRect").mockReturnValue({
      left: 100, top: 200, width: 200, height: 40,
    } as DOMRect);
    const host = document.createElement("div");
    host.append(platform);
    document.body.append(host);
    const engine = new ShimejiEngine(host, { platforms: [platform], random: () => 0.99 });
    engine.registerCharacter({
      ...spec,
      actions: [
        ...spec.actions,
        animatedAction("WalkWithIE", { x: 24, y: 0 }),
        animatedAction("Sit", { x: 0, y: 0 }),
        animatedAction("ClimbIEWall", { x: 0, y: 8 }, "Wall"),
      ],
      behaviors: [
        { ...spec.behaviors[0]!, frequency: 0 },
        { ...behavior("WalkWithIE"), frequency: 1_000 },
        { ...behavior("Sit"), frequency: 1_000 },
        {
          ...behavior("ClimbIEWall"),
          frequency: 1,
          conditions: ["#{mascot.environment.activeIE.rightBorder.isOn(mascot.anchor)}"],
        },
      ],
    });
    engine.spawn("test", { x: 295, y: 200, lookRight: false, behaviorName: "WalkWithIE" });

    frame?.(40);
    frame?.(80);

    expect(engine.getState()[0]).toMatchObject({ x: 300, y: 200, behaviorName: "ClimbIEWall" });
    engine.destroy();
  });

  it("does not invent a border for an unbordered animation", () => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frame = callback; return 7; }));
    const host = document.createElement("div");
    Object.defineProperties(host, {
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
    });
    document.body.append(host);
    const engine = new ShimejiEngine(host);
    engine.registerCharacter(withBehavior("Walk", animatedAction("Walk", { x: 24, y: 0 }, null)));
    engine.spawn("test", { x: 390, y: 100, vx: 10, behaviorName: "Walk" });

    frame?.(40);
    expect(engine.getState()[0]).toMatchObject({ x: 414, y: 100, behaviorName: "Walk" });
    engine.destroy();
  });

  it.each([
    { side: "right", startX: 390, startLookRight: false, wallX: 400, awayX: 0, velocityX: -24, finalX: 376, finalLookRight: false },
    { side: "left", startX: 10, startLookRight: true, wallX: 0, awayX: 400, velocityX: -24, finalX: 24, finalLookRight: true },
  ])("reaches the $side wall exactly and starts the configured next behavior", ({ startX, startLookRight, wallX, awayX, velocityX, finalX, finalLookRight }) => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frame = callback; return 7; }));
    const host = document.createElement("div");
    Object.defineProperties(host, {
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
    });
    document.body.append(host);
    const engine = new ShimejiEngine(host);
    const walkAway = behavior("WalkAway");
    engine.registerCharacter({
      ...spec,
      actions: [
        ...spec.actions,
        { ...animatedAction("WalkIntoWall", { x: velocityX, y: 0 }), type: "Move", targetX: wallX },
        { ...animatedAction("WalkAway", { x: velocityX, y: 0 }), type: "Move", targetX: awayX },
      ],
      behaviors: [
        ...spec.behaviors,
        { ...behavior("WalkIntoWall"), nextBehaviors: [walkAway], nextAdditive: false },
        walkAway,
      ],
    });
    engine.spawn("test", { x: startX, y: 300, lookRight: startLookRight, behaviorName: "WalkIntoWall" });

    frame?.(40);
    expect(engine.getState()[0]).toMatchObject({
      x: wallX,
      y: 300,
      lookRight: wallX > startX,
      behaviorName: "WalkAway",
    });

    frame?.(80);
    expect(engine.getState()[0]).toMatchObject({ x: finalX, y: 300, lookRight: finalLookRight, behaviorName: "WalkAway" });
    engine.destroy();
  });

  it("does not interrupt an animation that climbs a container wall", () => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frame = callback; return 7; }));
    vi.stubGlobal("innerWidth", 400);
    vi.stubGlobal("innerHeight", 300);
    const host = document.createElement("div");
    document.body.append(host);
    const engine = new ShimejiEngine(host);
    engine.registerCharacter(withBehavior("ClimbWall", animatedAction("ClimbWall", { x: 0, y: -8 }, "Wall")));
    engine.spawn("test", { x: 400, y: 200, lookRight: true, behaviorName: "ClimbWall" });

    frame?.(40);

    expect(engine.getState()[0]).toMatchObject({ x: 400, y: 192, behaviorName: "ClimbWall" });
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
    host.append(platform);
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
    host.append(platform);
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
    host.append(platform);
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
    host.append(platform);
    const engine = new ShimejiEngine(host, { platforms: [platform] });
    engine.registerCharacter(withBehavior("ClimbIEWall", animatedAction("ClimbIEWall", { x: 0, y: 8 }, "Wall")));
    engine.spawn("test", { x: 100, y: 200, lookRight: true, behaviorName: "ClimbIEWall" });

    frame?.(40);

    expect(engine.getState()[0]).toMatchObject({ x: 100, y: 208, behaviorName: "ClimbIEWall" });
    engine.destroy();
  });

  it("retains platform floor and wall borders at fractional CSS-pixel positions", () => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frame = callback; return 7; }));
    const platform = document.createElement("div");
    vi.spyOn(platform, "getBoundingClientRect").mockReturnValue({ left: 100.75, top: 200.75, width: 200, height: 40 } as DOMRect);
    const host = document.createElement("div");
    host.append(platform);
    document.body.append(host);
    const engine = new ShimejiEngine(host, { platforms: [platform] });
    engine.registerCharacter({
      ...spec,
      actions: [
        ...spec.actions,
        animatedAction("Sit", { x: 0, y: 0 }),
        animatedAction("ClimbIEWall", { x: 0, y: 8 }, "Wall"),
      ],
      behaviors: [...spec.behaviors, behavior("Sit"), behavior("ClimbIEWall")],
    });
    engine.spawn("test", { x: 150, y: 200, behaviorName: "Sit" });
    engine.spawn("test", { x: 100, y: 220, lookRight: true, behaviorName: "ClimbIEWall" });

    frame?.(40);

    expect(engine.getState()).toMatchObject([
      { x: 150, y: 200, behaviorName: "Sit" },
      { x: 100, y: 228, behaviorName: "ClimbIEWall" },
    ]);
    engine.destroy();
  });
});
