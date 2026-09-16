// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { normalizeCharacterSpec, parseActionsXml, parseBehaviorsXml } from "./loader";

const actions = `<?xml version="1.0"?><Mascot xmlns="urn:test"><ActionList>
  <Action Name="Fall" Type="Sequence"><ActionReference Name="Falling" /></Action>
  <Action Name="Falling" Type="Embedded" Class="com.group_finity.mascot.action.Fall" Gravity="2">
    <Animation><Pose Image="/shime4.png" Anchor="64,128" Velocity="0,0" Duration="250" /></Animation>
  </Action>
</ActionList></Mascot>`;
const behaviors = `<?xml version="1.0"?><Mascot xmlns="urn:test"><BehaviorList>
  <Behavior Name="Fall" Frequency="0" />
  <Behavior Name="Idle" Frequency="1"><NextBehavior Add="false"><BehaviorReferance Name="Idle" Frequency="2" /></NextBehavior></Behavior>
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
    expect(parsedBehaviors[1]?.nextBehaviors[0]).toMatchObject({ type: "Reference", name: "Idle" });
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
});
