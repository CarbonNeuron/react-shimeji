// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { character as japaneseCharacterPackage } from "../../character-vocaloid-oliver/index";
import { normalizeCharacterSpec, parseActionsXml, parseBehaviorsXml } from "./loader";

const actions = `<?xml version="1.0"?><Mascot xmlns="urn:test"><ActionList>
  <Action Name="Fall" Type="Sequence"><ActionReference Name="Falling" /></Action>
  <Action Name="Falling" Type="Embedded" Class="com.group_finity.mascot.action.Fall" Gravity="2" VelocityParam="20" RegistanceX="0.05">
    <Animation IsTurn="true"><Pose Image="/shime4.png" ImageAnchor="64,128" Velocity="0,0" Duration="250" /></Animation>
  </Action>
</ActionList></Mascot>`;
const behaviors = `<?xml version="1.0"?><Mascot xmlns="urn:test"><BehaviorList>
  <Behavior Name="Fall" Frequency="0" />
  <Behavior Name="Idle" Action="Fall" Frequency="1"><NextBehavior Add="false"><Condition Condition="#{mascot.totalCount &lt; 5}"><BehaviorReferance Name="Idle" Frequency="2" /></Condition></NextBehavior></Behavior>
  <Condition Condition="#{mascot.environment.floor.isOn(mascot.anchor)}">
    <Behavior Name="Stand" Frequency="100"><NextBehaviorList><BehaviorReference Name="Stand" Frequency="1" /></NextBehaviorList></Behavior>
  </Condition>
</BehaviorList></Mascot>`;

describe("legacy character loading", () => {
  it("parses XML action trees and behavior condition groups", () => {
    const parsedActions = parseActionsXml(actions);
    const parsedBehaviors = parseBehaviorsXml(behaviors);
    expect(parsedActions[0]).toMatchObject({ type: "Sequence", name: "Fall", actions: [{ type: "Reference", name: "Falling" }] });
    expect(parsedActions[1]).toMatchObject({ type: "Embedded", embedType: "Fall", gravity: "2" });
    expect(parsedActions[1]?.velocity).toBe("20");
    expect(parsedActions[1]?.resistanceX).toBe("0.05");
    expect(parsedActions[1]?.animations?.[0]).toMatchObject({ turn: true, poses: [{ anchor: { x: 64, y: 128 } }] });
    expect(parsedBehaviors[1]?.nextBehaviors[0]).toMatchObject({ type: "Reference", name: "Idle" });
    expect(parsedBehaviors[1]).toMatchObject({ actionName: "Fall", nextAdditive: false });
    expect(parsedBehaviors[1]?.nextBehaviors[0]?.conditions).toEqual(["#{mascot.totalCount < 5}"]);
    expect(parsedBehaviors[2]).toMatchObject({ name: "Stand", frequency: 100, groupIndex: 1 });
    expect(parsedBehaviors[2]?.conditions).toHaveLength(1);
    expect(parsedBehaviors[2]?.nextBehaviors[0]).toMatchObject({ type: "Reference", name: "Stand" });
  });

  it("normalizes the configuration.json bundle shape", () => {
    const spec = normalizeCharacterSpec({ id: "demo", spritesheet: "/sheet.png", sprites: JSON.stringify({ "/shime4.png": { x: 0, y: 0, width: 128, height: 128 } }), actions, behaviors });
    expect(spec.id).toBe("demo");
    expect(spec.actions).toHaveLength(2);
    expect(spec.sprites["/shime4.png"]).toEqual({ x: 0, y: 0, width: 128, height: 128 });
  });

  it("normalizes an existing Japanese XML character package without changing its format", () => {
    const parsed = normalizeCharacterSpec(japaneseCharacterPackage);
    const falling = parsed.actions.find((action) => action.embedType === "Fall");
    const jumping = parsed.actions.find((action) => action.embedType === "Jump");
    const breeding = parsed.actions.find((action) => action.embedType === "Breed");
    expect(parsed.id).toBe("vocaloid-oliver");
    expect(falling).toMatchObject({ resistanceX: "0.05", resistanceY: "0.1", gravity: "2" });
    expect(falling?.animations?.[0]?.poses[0]?.anchor).toEqual({ x: 64, y: 128 });
    expect(jumping?.velocity).toBe("20");
    expect(breeding?.bornBehavior).toBe("引っこ抜かれる");
    expect(parsed.behaviors.some((behavior) => behavior.nextAdditive === false)).toBe(true);
  });
});
