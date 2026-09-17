// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { ActionExecutor } from "./action";
import type { PlatformRectangle } from "./platform";
import type { ActionDefinition, CharacterSpec, EnvironmentRectangle, MascotEnvironment, MascotState, Rectangle } from "./types";

const bounds: Rectangle = { x: 0, y: 0, width: 400, height: 300 };

function rectangle(value: Rectangle): EnvironmentRectangle {
  const onTop = (point: { x: number; y: number }) => point.x >= value.x && point.x <= value.x + value.width && point.y === value.y;
  const onBottom = (point: { x: number; y: number }) => point.x >= value.x && point.x <= value.x + value.width && point.y === value.y + value.height;
  const onLeft = (point: { x: number; y: number }) => point.y >= value.y && point.y <= value.y + value.height && point.x === value.x;
  const onRight = (point: { x: number; y: number }) => point.y >= value.y && point.y <= value.y + value.height && point.x === value.x + value.width;
  return {
    ...value,
    left: value.x, right: value.x + value.width, top: value.y, bottom: value.y + value.height,
    topBorder: { isOn: onTop }, bottomBorder: { isOn: onBottom }, leftBorder: { isOn: onLeft }, rightBorder: { isOn: onRight },
  };
}

function environment(state: MascotState, platform?: PlatformRectangle): MascotEnvironment {
  const workArea = rectangle(bounds);
  const activeIE = platform
    ? { ...rectangle(platform), visible: true }
    : { ...rectangle({ x: -100, y: -100, width: 0, height: 0 }), visible: false };
  return {
    gap: 0, maxCount: 50,
    mascot: {
      totalCount: 1,
      anchor: { x: state.x, y: state.y },
      lookRight: state.lookRight,
      environment: {
        cursor: { x: 0, y: 0, dx: 0, dy: 0 },
        screen: { width: bounds.width, height: bounds.height },
        workArea,
        floor: { isOn: (point) => workArea.bottomBorder.isOn(point) || activeIE.topBorder.isOn(point) },
        ceiling: { isOn: (point) => workArea.topBorder.isOn(point) || activeIE.bottomBorder.isOn(point) },
        activeIE,
      },
    },
  };
}

function state(overrides: Partial<MascotState> = {}): MascotState {
  return {
    id: "one", characterId: "test", x: 0, y: 0, vx: 0, vy: 0,
    sprite: "/one.png", anchorX: 0, anchorY: 0, lookRight: false,
    behaviorName: "Test", dragging: false, ...overrides,
  };
}

function executor(action: ActionDefinition, mascot: MascotState): ActionExecutor {
  const spec: CharacterSpec = { id: "test", spritesheet: "", sprites: {}, actions: [action], behaviors: [] };
  return new ActionExecutor(spec, mascot, { frameDuration: 40, gravity: 2, random: () => 0 }, { spawn() {}, remove() {} });
}

const pose = (duration: number, x = 0, y = 0) => ({ sprite: "/one.png", anchor: { x: 0, y: 0 }, velocity: { x, y }, duration });

describe("Shimeji-ee action semantics", () => {
  it("loops Stay animations until action Duration but limits Animate to one animation cycle", () => {
    const staying = state();
    const stay = executor({ type: "Stay", name: "Test", duration: 4, animations: [{ poses: [pose(2, 2)] }] }, staying);
    expect(stay.start("Test", environment(staying))).toBe(true);
    expect([1, 2, 3, 4].map(() => stay.step(environment(staying), bounds))).toEqual(["running", "running", "running", "complete"]);
    expect(staying.x).toBe(8);

    const animating = state();
    const animate = executor({ type: "Animate", name: "Test", duration: 99, animations: [{ poses: [pose(2, 2)] }] }, animating);
    animate.start("Test", environment(animating));
    expect(animate.step(environment(animating), bounds)).toBe("running");
    expect(animate.step(environment(animating), bounds)).toBe("complete");
    expect(animating.x).toBe(4);
  });

  it("reports lost ground on the tick after a pose leaves its retained border", () => {
    const platform = { element: document.createElement("div"), x: 100, y: 200, width: 100, height: 20 };
    const mascot = state({ x: 199, y: 200 });
    const action = executor({ type: "Stay", name: "Test", borderType: "Floor", duration: 10, animations: [{ poses: [pose(10, 2)] }] }, mascot);
    action.start("Test", environment(mascot, platform), false, bounds, [platform]);
    expect(action.step(environment(mascot, platform), bounds, [platform])).toBe("running");
    expect(mascot.x).toBe(201);
    expect(action.step(environment(mascot, platform), bounds, [platform])).toBe("lost-ground");
    expect(mascot.x).toBe(201);
  });

  it("clamps Move to its target and uses the target to choose facing", () => {
    const mascot = state({ x: 9, y: 300 });
    const action = executor({ type: "Move", name: "Test", borderType: "Floor", targetX: 10, animations: [{ poses: [pose(20, -3)] }] }, mascot);
    action.start("Test", environment(mascot), false, bounds);
    expect(action.step(environment(mascot), bounds)).toBe("complete");
    expect(mascot).toMatchObject({ x: 10, lookRight: true });
  });

  it("uses Java's damp-then-accelerate fall step and path collision", () => {
    const platform = { element: document.createElement("div"), x: 100, y: 200, width: 100, height: 20 };
    const mascot = state({ x: 150, y: 190, vy: 20 });
    const action = executor({ type: "Embedded", name: "Test", embedType: "Fall", initialVy: 20, resistanceX: 0, resistanceY: 0, gravity: 0, animations: [{ poses: [pose(10)] }] }, mascot);
    action.start("Test", environment(mascot, platform), false, bounds, [platform]);
    expect(action.step(environment(mascot, platform), bounds, [platform])).toBe("complete");
    expect(mascot).toMatchObject({ x: 150, y: 200, vy: 20 });
  });

  it("keeps FallWithIE attached to a fractional active platform", () => {
    const platform = { element: document.createElement("div"), x: 100.75, y: 200.75, width: 100, height: 20 };
    const mascot = state({ x: 165, y: 157, lookRight: true });
    const movePlatform = vi.fn();
    const action = new ActionExecutor({
      id: "test",
      spritesheet: "",
      sprites: {},
      behaviors: [],
      actions: [{
        type: "Embedded", name: "Test", embedType: "FallWithIE",
        ieOffsetX: 64, ieOffsetY: 64, resistanceX: 0, resistanceY: 0, gravity: 0,
      }],
    }, mascot, { frameDuration: 40, gravity: 2, random: () => 0 }, { spawn() {}, remove() {}, movePlatform });

    action.start("Test", environment(mascot, platform), false, bounds, [platform]);

    expect(action.step(environment(mascot, platform), bounds, [platform])).toBe("running");
    expect(movePlatform).toHaveBeenCalledWith(platform.element, { x: 101, y: 201 });
  });

  it("keeps WalkWithIE attached across the full sub-pixel DOM range", () => {
    const platform = { element: document.createElement("div"), x: 100.9999995, y: 280.9999995, width: 100, height: 20 };
    const mascot = state({ x: 165, y: 300, lookRight: true });
    const movePlatform = vi.fn();
    const action = new ActionExecutor({
      id: "test",
      spritesheet: "",
      sprites: {},
      behaviors: [],
      actions: [{
        type: "Embedded", name: "Test", embedType: "WalkWithIE", borderType: "Floor",
        targetX: 250, ieOffsetX: 64, ieOffsetY: 0, animations: [{ poses: [pose(10, -1)] }],
      }],
    }, mascot, { frameDuration: 40, gravity: 2, random: () => 0 }, { spawn() {}, remove() {}, movePlatform });

    action.start("Test", environment(mascot, platform), false, bounds, [platform]);

    expect(action.step(environment(mascot, platform), bounds, [platform])).toBe("running");
    expect(movePlatform).toHaveBeenCalledWith(platform.element, { x: 102, y: 280 });
  });

  it("exposes updated Fall velocity variables to animation conditions", () => {
    const mascot = state({ x: 150, y: 100 });
    const action = executor({
      type: "Embedded", name: "Test", embedType: "Fall", initialVy: -10, resistanceY: 0, gravity: 0,
      animations: [
        { condition: "#{VelocityY < 0}", poses: [{ ...pose(10), sprite: "/up.png" }] },
        { poses: [{ ...pose(10), sprite: "/down.png" }] },
      ],
    }, mascot);
    action.start("Test", environment(mascot));
    action.step(environment(mascot), bounds);
    expect(mascot.sprite).toBe("/up.png");
  });

  it("uses the parabolic Jump target and applies instant sequence actions during initialization", () => {
    const jumping = state({ y: 50 });
    const jump = executor({ type: "Embedded", name: "Test", embedType: "Jump", targetX: 100, targetY: 50, velocity: 200 }, jumping);
    jump.start("Test", environment(jumping));
    expect(jump.step(environment(jumping), bounds)).toBe("complete");
    expect(jumping).toMatchObject({ x: 100, y: 50, lookRight: true });

    const sequenced = state();
    const sequence = executor({
      type: "Sequence", name: "Test", actions: [
        { type: "Embedded", embedType: "Offset", x: 5 },
        { type: "Animate", animations: [{ poses: [pose(1, 2)] }] },
      ],
    }, sequenced);
    sequence.start("Test", environment(sequenced));
    expect(sequenced.x).toBe(5);
    expect(sequence.step(environment(sequenced), bounds)).toBe("complete");
    expect(sequenced.x).toBe(7);
  });

  it("Select skips ineffective children and stops after the selected child", () => {
    const mascot = state();
    const action = executor({
      type: "Select", name: "Test", actions: [
        { type: "Animate", condition: "false", animations: [{ poses: [pose(1, 50)] }] },
        { type: "Animate", animations: [{ poses: [pose(1, 2)] }] },
        { type: "Animate", animations: [{ poses: [pose(1, 50)] }] },
      ],
    }, mascot);
    action.start("Test", environment(mascot));
    expect(action.step(environment(mascot), bounds)).toBe("complete");
    expect(mascot.x).toBe(2);
  });

  it("runs a Turn animation only when the requested direction differs", () => {
    const mascot = state({ lookRight: false });
    const action = executor({ type: "Embedded", name: "Test", embedType: "Turn", lookRight: true, animations: [{ poses: [pose(2)] }] }, mascot);
    action.start("Test", environment(mascot));
    expect(action.step(environment(mascot), bounds)).toBe("running");
    expect(mascot.lookRight).toBe(true);
    expect(action.step(environment(mascot), bounds)).toBe("complete");

    const noTurn = executor({ type: "Embedded", name: "Test", embedType: "Turn", lookRight: true, animations: [{ poses: [pose(2)] }] }, mascot);
    noTurn.start("Test", environment(mascot));
    expect(noTurn.hasNext(environment(mascot), bounds)).toBe(false);
  });

  it("uses the cursor tether and FootX conditions for Dragged", () => {
    const mascot = state({ lookRight: true });
    const spec: CharacterSpec = {
      id: "test", spritesheet: "", sprites: {}, behaviors: [],
      actions: [{
        type: "Embedded", name: "Test", embedType: "Dragged",
        animations: [
          { condition: "#{FootX < mascot.environment.cursor.x}", poses: [{ ...pose(5), sprite: "/left.png" }] },
          { poses: [{ ...pose(5), sprite: "/center.png" }] },
        ],
      }],
    };
    const action = new ActionExecutor(spec, mascot, { frameDuration: 40, gravity: 2, random: () => 0 }, { spawn() {}, remove() {} });
    const currentEnvironment = environment(mascot);
    currentEnvironment.mascot.environment.cursor = { x: 20, y: 30, dx: 0, dy: 0 };
    action.start("Test", currentEnvironment);
    expect(action.step(currentEnvironment, bounds)).toBe("running");
    expect(mascot).toMatchObject({ x: 20, y: 150, lookRight: false, dragging: true, sprite: "/center.png" });
  });
});
