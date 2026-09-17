import type {
  ActionDefinition,
  ActionType,
  AnimationDefinition,
  BehaviorDefinition,
  BorderType,
  CharacterSource,
  CharacterSpec,
  LegacyCharacterPack,
  Point,
  Pose,
  SpriteMap,
} from "./types";

const actionTypeNames: Record<string, ActionType> = {
  Sequence: "Sequence", Select: "Select", Reference: "Reference", Stay: "Stay", Animate: "Animate", Move: "Move", Embedded: "Embedded",
  Composite: "Sequence", Fixed: "Animate", Pause: "Stay",
  複合: "Sequence", 選択: "Select", 参照: "Reference", 静止: "Stay", 固定: "Animate", 移動: "Move", 組み込み: "Embedded",
};
const borderTypeNames: Record<string, BorderType> = { Floor: "Floor", Wall: "Wall", Ceiling: "Ceiling", 地面: "Floor", 壁: "Wall", 天井: "Ceiling" };

function parseJson<T>(value: T | string, label: string): T {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value) as T; } catch (error) { throw new TypeError(`Invalid ${label}: ${error instanceof Error ? error.message : String(error)}`); }
}

function attribute(element: Element, ...names: string[]): string | undefined {
  for (const name of names) { const value = element.getAttribute(name); if (value !== null) return value; }
  return undefined;
}

function directChildren(element: Element, ...names: string[]): Element[] {
  const accepted = new Set(names);
  return Array.from(element.children).filter((child) => accepted.has(child.localName) || accepted.has(child.tagName));
}

function parsePoint(value: string | undefined, fallback: Point = { x: 0, y: 0 }): Point {
  if (!value) return fallback;
  const [x = fallback.x, y = fallback.y] = value.split(",").map(Number);
  return { x: Number.isFinite(x) ? x : fallback.x, y: Number.isFinite(y) ? y : fallback.y };
}

function requireDomParser(): DOMParser {
  if (typeof DOMParser === "undefined") throw new Error("XML character packs require the browser DOMParser API; use pre-parsed JSON in non-browser environments");
  return new DOMParser();
}

function parseDocument(xml: string, label: string): Document {
  const document = requireDomParser().parseFromString(xml.replace(/^\uFEFF/, ""), "application/xml");
  const error = document.querySelector("parsererror");
  if (error) throw new TypeError(`Invalid ${label}: ${error.textContent?.trim() ?? "XML parse error"}`);
  return document;
}

function actionProperty(element: Element, ...names: string[]): string | undefined { return attribute(element, ...names); }

function parseAnimation(element: Element): AnimationDefinition {
  const poses = directChildren(element, "Pose", "ポーズ").map((pose): Pose => ({
    sprite: attribute(pose, "Image", "画像") ?? "/shime1.png",
    anchor: parsePoint(attribute(pose, "ImageAnchor", "Anchor", "基準座標"), { x: 64, y: 128 }),
    velocity: parsePoint(attribute(pose, "Velocity", "移動速度")),
    duration: Number(attribute(pose, "Duration", "長さ") ?? 1),
  }));
  const condition = attribute(element, "Condition", "条件");
  const turn = (attribute(element, "IsTurn", "Turn") ?? "false").toLowerCase() === "true";
  return { poses, ...(condition !== undefined && { condition }), ...(turn && { turn }) };
}

function parseActionElement(element: Element): ActionDefinition {
  const isReference = element.localName === "ActionReference" || element.localName === "動作参照";
  const rawType = isReference ? "Reference" : attribute(element, "Type", "種類") ?? (directChildren(element, "Action", "動作", "ActionReference", "動作参照").length ? "Sequence" : "Animate");
  const className = attribute(element, "Class", "クラス");
  const embedType = className?.split(".").at(-1);
  const type = actionTypeNames[rawType] ?? (embedType ? "Embedded" : "Animate");
  const name = attribute(element, "Name", "名前");
  const condition = actionProperty(element, "Condition", "条件");
  const borderRaw = actionProperty(element, "BorderType", "Border", "枠");
  const actions = directChildren(element, "Action", "動作", "ActionReference", "動作参照").map(parseActionElement);
  const animations = directChildren(element, "Animation", "アニメーション").map(parseAnimation);
  const result: ActionDefinition = {
    type,
    ...(name !== undefined && { name }),
    ...(embedType !== undefined && { embedType }),
    ...(condition !== undefined && { condition }),
    ...(borderRaw !== undefined && borderTypeNames[borderRaw] !== undefined && { borderType: borderTypeNames[borderRaw] }),
    ...(actions.length > 0 && { actions }),
    ...(animations.length > 0 && { animations }),
  };
  const properties: Array<[keyof ActionDefinition, string | undefined]> = [
    ["duration", actionProperty(element, "Duration", "長さ")], ["gap", actionProperty(element, "Gap", "間隔", "ずれ")], ["targetX", actionProperty(element, "TargetX", "目的地X")],
    ["targetY", actionProperty(element, "TargetY", "目的地Y")], ["velocity", actionProperty(element, "VelocityParam", "Velocity", "速度")],
    ["x", actionProperty(element, "X", "変位X")], ["y", actionProperty(element, "Y", "変位Y")],
    ["offsetX", actionProperty(element, "OffsetX", "端X")], ["offsetY", actionProperty(element, "OffsetY", "端Y")],
    ["offsetType", actionProperty(element, "OffsetType")],
    ["initialVx", actionProperty(element, "InitialVX", "InitialVx", "初速X")], ["initialVy", actionProperty(element, "InitialVY", "InitialVy", "初速Y")],
    ["resistanceX", actionProperty(element, "RegistanceX", "ResistanceX", "空気抵抗X")], ["resistanceY", actionProperty(element, "RegistanceY", "ResistanceY", "空気抵抗Y")],
    ["gravity", actionProperty(element, "Gravity", "重力")], ["bornX", actionProperty(element, "BornX", "誕生X", "生まれる場所X")],
    ["bornY", actionProperty(element, "BornY", "誕生Y", "生まれる場所Y")], ["bornBehavior", actionProperty(element, "BornBehavior", "BornBehaviour", "誕生時の行動", "生まれた時の行動")],
    ["bornMascot", actionProperty(element, "BornMascot")], ["bornCount", actionProperty(element, "BornCount")],
    ["bornInterval", actionProperty(element, "BornInterval")],
    ["ieOffsetX", actionProperty(element, "IEOffsetX", "IEの端X")], ["ieOffsetY", actionProperty(element, "IEOffsetY", "IEの端Y")],
    ["lookRight", actionProperty(element, "LookRight", "右向き")],
  ];
  for (const [key, value] of properties) if (value !== undefined) (result as unknown as Record<string, unknown>)[key] = value;
  const loop = actionProperty(element, "Loop", "繰り返し");
  if (loop !== undefined) result.loop = loop.toLowerCase() === "true";
  return result;
}

/** Parses a legacy `actions.xml` document into normalized action definitions. */
export function parseActionsXml(xml: string): ActionDefinition[] {
  const document = parseDocument(xml, "actions.xml");
  const lists = Array.from(document.getElementsByTagNameNS("*", "ActionList")).concat(Array.from(document.getElementsByTagNameNS("*", "動作リスト")));
  const roots = lists.length ? lists : [document.documentElement];
  return roots.flatMap((list) => directChildren(list, "Action", "動作").map(parseActionElement));
}

function parseNextBehaviors(element: Element, inheritedConditions: readonly string[]): BehaviorDefinition[] {
  const behaviors: BehaviorDefinition[] = [];
  for (const child of Array.from(element.children)) {
    if (child.localName === "Condition" || child.localName === "条件") {
      const condition = attribute(child, "Condition", "条件");
      behaviors.push(...parseNextBehaviors(child, [...inheritedConditions, ...(condition ? [condition] : [])]));
    } else if (["Behavior", "行動", "BehaviorReference", "BehaviorReferance", "行動参照"].includes(child.localName)) {
      behaviors.push(parseBehaviorElement(child, inheritedConditions, 0));
    }
  }
  return behaviors;
}

function parseBehaviorElement(element: Element, inheritedConditions: readonly string[], groupIndex: number): BehaviorDefinition {
  const condition = attribute(element, "Condition", "条件");
  const conditions = [...inheritedConditions, ...(condition ? [condition] : [])];
  const nextList = directChildren(element, "NextBehaviorList", "NextBehavior", "次の行動リスト")[0];
  const nextBehaviors = nextList ? parseNextBehaviors(nextList, []) : [];
  const reference = element.localName === "BehaviorReference" || element.localName === "BehaviorReferance" || element.localName === "行動参照";
  const actionName = attribute(element, "Action", "動作");
  return {
    type: reference ? "Reference" : "Behavior",
    name: attribute(element, "Name", "名前") ?? "",
    frequency: Number(attribute(element, "Frequency", "頻度") ?? 0),
    conditions,
    nextBehaviors,
    ...(nextList && { nextAdditive: (attribute(nextList, "Add", "追加") ?? "true").toLowerCase() === "true" }),
    ...(actionName !== undefined && { actionName }),
    groupIndex,
    hidden: (attribute(element, "Hidden", "非表示") ?? "false").toLowerCase() === "true",
  };
}

/** Parses a legacy `behaviors.xml` document into normalized behavior definitions. */
export function parseBehaviorsXml(xml: string): BehaviorDefinition[] {
  const document = parseDocument(xml, "behaviors.xml");
  const lists = Array.from(document.getElementsByTagNameNS("*", "BehaviorList")).concat(Array.from(document.getElementsByTagNameNS("*", "行動リスト")));
  const root = lists[0] ?? document.documentElement;
  const behaviors: BehaviorDefinition[] = [];
  let groupIndex = 0;
  for (const child of Array.from(root.children)) {
    if (child.localName === "Condition" || child.localName === "条件") {
      groupIndex += 1;
      const condition = attribute(child, "Condition", "条件");
      const inherited = condition ? [condition] : [];
      behaviors.push(...directChildren(child, "Behavior", "行動", "BehaviorReference", "BehaviorReferance", "行動参照").map((element) => parseBehaviorElement(element, inherited, groupIndex)));
    } else if (["Behavior", "行動", "BehaviorReference", "BehaviorReferance", "行動参照"].includes(child.localName)) {
      behaviors.push(parseBehaviorElement(child, [], 0));
    }
  }
  return behaviors;
}

function isCharacterSpec(value: unknown): value is CharacterSpec {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CharacterSpec>;
  return typeof candidate.id === "string" && Array.isArray(candidate.actions) && Array.isArray(candidate.behaviors) && typeof candidate.sprites === "object" && candidate.sprites !== null && (typeof candidate.spritesheet === "string" || (typeof Blob !== "undefined" && candidate.spritesheet instanceof Blob));
}

/** Converts a pre-parsed definition or raw XML/JSON legacy bundle to a character specification. */
export function normalizeCharacterSpec(input: CharacterSpec | LegacyCharacterPack | unknown): CharacterSpec {
  let candidate: unknown = input;
  if (typeof candidate === "string") candidate = parseJson<unknown>(candidate, "character JSON");
  if (!candidate || typeof candidate !== "object") throw new TypeError("Character data must be an object");
  const record = candidate as Record<string, unknown>;
  if (record.configuration) {
    const configuration = typeof record.configuration === "string"
      ? parseJson<Record<string, unknown>>(record.configuration, "configuration")
      : record.configuration;
    if (typeof configuration === "object") candidate = { ...(configuration as object), ...record };
  }
  const pack = candidate as Partial<LegacyCharacterPack> & Record<string, unknown>;
  const id = typeof pack.id === "string" ? pack.id : typeof pack.metadata?.shimeji === "string" ? pack.metadata.shimeji : undefined;
  if (!id) throw new TypeError("Character specification requires an id");
  if (pack.actions === undefined || pack.behaviors === undefined || pack.sprites === undefined || pack.spritesheet === undefined) throw new TypeError(`Character '${id}' is missing actions, behaviors, sprites, or spritesheet`);
  const actions = typeof pack.actions === "string" && pack.actions.trimStart().startsWith("<") ? parseActionsXml(pack.actions) : parseJson<ActionDefinition[]>(pack.actions, "actions");
  const behaviors = typeof pack.behaviors === "string" && pack.behaviors.trimStart().startsWith("<") ? parseBehaviorsXml(pack.behaviors) : parseJson<BehaviorDefinition[]>(pack.behaviors, "behaviors");
  const sprites = parseJson<SpriteMap>(pack.sprites, "sprites");
  const spec: CharacterSpec = {
    id,
    spritesheet: pack.spritesheet,
    sprites,
    actions,
    behaviors,
    ...(typeof pack.name === "string" && { name: pack.name }),
    ...(pack.metadata !== undefined && { metadata: pack.metadata }),
  };
  if (!isCharacterSpec(spec)) throw new TypeError(`Character '${id}' could not be normalized`);
  return spec;
}

/** Loads character JSON from a URL or normalizes an already available character bundle. */
export async function loadCharacter(source: CharacterSource): Promise<CharacterSpec> {
  if (typeof source !== "string" && !(source instanceof URL)) return normalizeCharacterSpec(source);
  const url = source instanceof URL ? source : new URL(source, typeof document === "undefined" ? "http://localhost/" : document.baseURI);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load character '${url}': ${response.status} ${response.statusText}`);
  const spec = normalizeCharacterSpec(await response.json() as unknown);
  if (typeof spec.spritesheet === "string" && !/^(?:data:|blob:)/.test(spec.spritesheet)) {
    spec.spritesheet = new URL(spec.spritesheet, url).toString();
  }
  return spec;
}
