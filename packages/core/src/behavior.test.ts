import { describe, expect, it } from "vitest";
import { evaluateExpression, selectWeighted } from "./behavior";
import type { MascotEnvironment } from "./types";

const environment = {
  gap: 0,
  maxCount: 50,
  targetX: 20,
  mascot: {
    totalCount: 2,
    anchor: { x: 10, y: 100 },
    lookRight: false,
    environment: {
      cursor: { x: 40, y: 50, dx: 0, dy: 0 },
      screen: { width: 800, height: 600 },
      workArea: {} as never,
      floor: { isOn: (point: { x: number; y: number }) => point.y === 100 },
      ceiling: { isOn: () => false },
      activeIE: {} as never,
    },
  },
} satisfies MascotEnvironment;

describe("legacy expressions", () => {
  it("evaluates member calls, aliases, math functions, and ternaries", () => {
    expect(evaluateExpression("#{mascot.environment.floor.isOn(mascot.anchor) && TargetX > mascot.anchor.x}", environment, false)).toBe(true);
    expect(evaluateExpression("${Math.max(2, 4) + (mascot.lookRight ? 1 : 3)}", environment, 0)).toBe(7);
  });

  it("fails closed for unsupported or unsafe syntax", () => {
    expect(evaluateExpression("mascot.constructor.constructor('return 1')()", environment, false)).toBe(false);
  });
});

describe("weighted selection", () => {
  it("uses configured weights and ignores zero-weight entries", () => {
    const values = [{ id: "never", weight: 0 }, { id: "first", weight: 1 }, { id: "second", weight: 3 }];
    expect(selectWeighted(values, (value) => value.weight, () => 0)?.id).toBe("first");
    expect(selectWeighted(values, (value) => value.weight, () => 0.99)?.id).toBe("second");
  });
});
