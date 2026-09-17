import { evaluateExpression } from "./behavior";
import { isOnBottom, isOnFloor, isOnLeft, isOnRight, isOnTop, isOnWall } from "./physics";
import type { PlatformRectangle } from "./platform";
import type {
  ActionDefinition,
  AnimationDefinition,
  BorderType,
  CharacterSpec,
  MascotEnvironment,
  MascotState,
  Point,
  Pose,
  Rectangle,
} from "./types";

/** Callbacks through which embedded actions request engine-level operations. */
export interface ActionExecutorCallbacks {
  /** Spawns another mascot, optionally from another registered character. */
  spawn(position: { x: number; y: number; behaviorName?: string; lookRight?: boolean }, characterId?: string): void;
  /** Removes the mascot owning this executor. */
  remove(): void;
  /** Moves a DOM platform for the legacy IE-carrying actions. */
  movePlatform?(element: HTMLElement, point: Point): void;
}

/** Settings used while interpreting actions. */
export interface ActionExecutorOptions {
  /** Duration of one legacy animation unit in milliseconds. */
  frameDuration: number;
  /** Gravity used when a Fall action does not define one. */
  gravity: number;
  /** Optional deterministic random-number source. */
  random?: (() => number) | undefined;
}

export type ActionTickResult = "running" | "complete" | "lost-ground";

interface RuntimeContext {
  environment: MascotEnvironment;
  bounds: Rectangle;
  platforms: readonly PlatformRectangle[];
}

interface Runtime {
  init(context: RuntimeContext): void;
  hasNext(context: RuntimeContext): boolean;
  step(context: RuntimeContext): "running" | "lost-ground";
}

function expressionIsPerFrame(value: unknown): boolean {
  return typeof value === "string" && value.trimStart().startsWith("#{");
}

class ActionValues {
  private readonly actionCache = new Map<string, number | boolean>();
  private readonly frameCache = new Map<string, number | boolean>();

  public constructor(private readonly random: () => number) {}

  public init(): void {
    this.actionCache.clear();
    this.frameCache.clear();
  }

  public initFrame(): void { this.frameCache.clear(); }

  public number(key: string, value: string | number | undefined, environment: MascotEnvironment, fallback: number): number {
    if (value === undefined) return fallback;
    if (typeof value === "number") return value;
    const cache = expressionIsPerFrame(value) ? this.frameCache : this.actionCache;
    const cached = cache.get(key);
    if (typeof cached === "number") return cached;
    const result = evaluateExpression(value, environment, fallback, this.random);
    cache.set(key, result);
    return result;
  }

  public boolean(key: string, value: string | boolean | undefined, environment: MascotEnvironment, fallback: boolean): boolean {
    if (value === undefined) return fallback;
    if (typeof value === "boolean") return value;
    const cache = expressionIsPerFrame(value) ? this.frameCache : this.actionCache;
    const cached = cache.get(key);
    if (typeof cached === "boolean") return cached;
    const result = evaluateExpression(value, environment, fallback, this.random);
    cache.set(key, result);
    return result;
  }
}

abstract class RuntimeBase implements Runtime {
  protected time = 0;
  protected readonly values: ActionValues;

  protected constructor(protected readonly definition: ActionDefinition, random: () => number) {
    this.values = new ActionValues(random);
  }

  public init(context: RuntimeContext): void {
    this.time = 0;
    this.values.init();
    this.onInit(context);
  }

  public hasNext(context: RuntimeContext): boolean {
    return this.baseHasNext(context) && this.hasMore(context);
  }

  public step(context: RuntimeContext): "running" | "lost-ground" {
    this.values.initFrame();
    const result = this.tick(context);
    this.time += 1;
    return result;
  }

  protected onInit(_context: RuntimeContext): void {}
  protected hasMore(_context: RuntimeContext): boolean { return true; }
  protected baseHasNext(context: RuntimeContext): boolean {
    const condition = this.values.boolean("condition", this.definition.condition, context.environment, true);
    const duration = Math.trunc(this.values.number("duration", this.definition.duration, context.environment, Number.POSITIVE_INFINITY));
    return condition && this.time < duration;
  }
  protected abstract tick(context: RuntimeContext): "running" | "lost-ground";
}

type BorderSide = "top" | "bottom" | "left" | "right";

class TrackedBorder {
  private previous: Rectangle | undefined;

  public constructor(
    private readonly side: BorderSide,
    private readonly source: "work-area" | HTMLElement | undefined,
    context: RuntimeContext,
  ) { this.previous = this.rectangle(context); }

  public move(point: Point, context: RuntimeContext): Point {
    const current = this.rectangle(context);
    const previous = this.previous;
    this.previous = current;
    if (!current || !previous) return point;
    if (this.side === "left" || this.side === "right") {
      if (previous.height === 0) return point;
      const next = {
        x: point.x + this.coordinate(current) - this.coordinate(previous),
        y: Math.trunc(((point.y - previous.y) * current.height) / previous.height + current.y),
      };
      return Math.abs(next.x - point.x) >= 80 || Math.abs(next.y - point.y) >= 80 ? point : next;
    }
    if (previous.width === 0) return point;
    const next = {
      // FloorCeiling.java performs integer division before applying the
      // mascot's relative offset along a resized border.
      x: (point.x - previous.x) * Math.trunc(current.width / previous.width) + current.x,
      y: point.y + this.coordinate(current) - this.coordinate(previous),
    };
    return Math.abs(next.x - point.x) >= 80 || next.y - point.y > 20 || next.y - point.y < -80 ? point : next;
  }

  public isOn(point: Point, context: RuntimeContext): boolean {
    const rectangle = this.rectangle(context);
    if (!rectangle) return false;
    switch (this.side) {
      case "top": return isOnTop(point, rectangle);
      case "bottom": return isOnBottom(point, rectangle);
      case "left": return isOnLeft(point, rectangle);
      case "right": return isOnRight(point, rectangle);
    }
  }

  private coordinate(rectangle: Rectangle): number {
    switch (this.side) {
      case "top": return rectangle.y;
      case "bottom": return rectangle.y + rectangle.height;
      case "left": return rectangle.x;
      case "right": return rectangle.x + rectangle.width;
    }
  }

  private rectangle(context: RuntimeContext): Rectangle | undefined {
    if (this.source === "work-area") return context.bounds;
    if (!this.source) return undefined;
    return context.platforms.find((platform) => platform.element === this.source);
  }
}

function selectBorder(type: BorderType, state: MascotState, context: RuntimeContext): TrackedBorder {
  if (type === "Floor") {
    const platform = context.platforms.find((candidate) => isOnTop(state, candidate));
    if (platform) return new TrackedBorder("top", platform.element, context);
    if (isOnBottom(state, context.bounds)) return new TrackedBorder("bottom", "work-area", context);
    return new TrackedBorder("bottom", undefined, context);
  }
  if (type === "Ceiling") {
    const platform = context.platforms.find((candidate) => isOnBottom(state, candidate));
    if (platform) return new TrackedBorder("bottom", platform.element, context);
    if (isOnTop(state, context.bounds)) return new TrackedBorder("top", "work-area", context);
    return new TrackedBorder("top", undefined, context);
  }
  if (state.lookRight) {
    const platform = context.platforms.find((candidate) => isOnLeft(state, candidate));
    if (platform) return new TrackedBorder("left", platform.element, context);
    if (isOnRight(state, context.bounds)) return new TrackedBorder("right", "work-area", context);
    return new TrackedBorder("right", undefined, context);
  }
  const platform = context.platforms.find((candidate) => isOnRight(state, candidate));
  if (platform) return new TrackedBorder("right", platform.element, context);
  if (isOnLeft(state, context.bounds)) return new TrackedBorder("left", "work-area", context);
  return new TrackedBorder("left", undefined, context);
}

abstract class AnimatedRuntime extends RuntimeBase {
  protected border: TrackedBorder | undefined;

  public constructor(definition: ActionDefinition, protected readonly state: MascotState, random: () => number) {
    super(definition, random);
  }

  protected override onInit(context: RuntimeContext): void {
    this.border = this.definition.borderType ? selectBorder(this.definition.borderType, this.state, context) : undefined;
  }

  protected animation(context: RuntimeContext, turn?: boolean): AnimationDefinition | undefined {
    const scoped = this.scopedEnvironment(context.environment);
    return this.definition.animations?.find((animation, index) =>
      (turn === undefined || Boolean(animation.turn) === turn)
      && this.values.boolean(`animation-${index}`, animation.condition, scoped, true));
  }

  protected animationDuration(context: RuntimeContext, turn?: boolean): number {
    return this.animation(context, turn)?.poses.reduce((sum, pose) => sum + Math.max(0, pose.duration), 0) ?? 0;
  }

  protected applyBorder(context: RuntimeContext): "running" | "lost-ground" {
    if (!this.border) return "running";
    const moved = this.border.move(this.state, context);
    this.state.x = moved.x;
    this.state.y = moved.y;
    return this.border.isOn(this.state, context) ? "running" : "lost-ground";
  }

  protected applyAnimation(context: RuntimeContext, turn?: boolean): void {
    const animation = this.animation(context, turn);
    const pose = animation && poseAt(animation, this.time);
    if (pose) applyPose(this.state, pose);
  }

  protected scopedEnvironment(environment: MascotEnvironment): MascotEnvironment {
    const gap = this.values.number("gap", this.definition.gap, environment, 0);
    const withGap = { ...environment, gap };
    const targetX = this.definition.targetX === undefined ? undefined : this.values.number("targetX", this.definition.targetX, withGap, 0);
    const targetY = this.definition.targetY === undefined ? undefined : this.values.number("targetY", this.definition.targetY, withGap, 0);
    return { ...withGap, ...(targetX !== undefined && { targetX }), ...(targetY !== undefined && { targetY }) };
  }
}

function poseAt(animation: AnimationDefinition, time: number): Pose | undefined {
  const duration = animation.poses.reduce((sum, pose) => sum + Math.max(0, pose.duration), 0);
  if (duration <= 0) return undefined;
  let cursor = time % duration;
  for (const pose of animation.poses) {
    cursor -= Math.max(0, pose.duration);
    if (cursor < 0) return pose;
  }
  return animation.poses.at(-1);
}

function applyPose(state: MascotState, pose: Pose): void {
  state.sprite = pose.sprite;
  state.anchorX = pose.anchor.x;
  state.anchorY = pose.anchor.y;
  state.x += (state.lookRight ? -1 : 1) * pose.velocity.x;
  state.y += pose.velocity.y;
}

class StayRuntime extends AnimatedRuntime {
  protected override tick(context: RuntimeContext): "running" | "lost-ground" {
    const border = this.applyBorder(context);
    if (border === "lost-ground") return border;
    this.applyAnimation(context);
    return "running";
  }
}

class AnimateRuntime extends StayRuntime {
  protected override hasMore(context: RuntimeContext): boolean { return this.time < this.animationDuration(context); }
}

class MoveRuntime extends AnimatedRuntime {
  protected turning = false;
  protected hasTurningAnimation = false;

  protected override onInit(context: RuntimeContext): void {
    super.onInit(context);
    this.turning = false;
    this.hasTurningAnimation = this.definition.animations?.some((animation) => animation.turn) ?? false;
  }

  protected override hasMore(context: RuntimeContext): boolean {
    const scoped = this.scopedEnvironment(context.environment);
    const targetX = this.targetX(scoped);
    const targetY = this.targetY(scoped);
    const reached = (targetX !== undefined && this.state.x === targetX) || (targetY !== undefined && this.state.y === targetY);
    return !reached || this.turning;
  }

  protected override tick(context: RuntimeContext): "running" | "lost-ground" {
    const border = this.applyBorder(context);
    if (border === "lost-ground") return border;
    const scoped = this.scopedEnvironment(context.environment);
    const targetX = this.targetX(scoped);
    const targetY = this.targetY(scoped);
    let down = false;
    if (targetX !== undefined && this.state.x !== targetX) {
      const nextLookRight = this.state.x < targetX;
      this.turning = this.hasTurningAnimation && (this.turning || nextLookRight !== this.state.lookRight);
      this.state.lookRight = nextLookRight;
    }
    if (targetY !== undefined) down = this.state.y < targetY;
    if (this.turning && this.time >= this.animationDuration(context, true)) this.turning = false;
    this.applyAnimation(context, this.turning);
    if (targetX !== undefined && ((this.state.lookRight && this.state.x >= targetX) || (!this.state.lookRight && this.state.x <= targetX))) this.state.x = targetX;
    if (targetY !== undefined && ((down && this.state.y >= targetY) || (!down && this.state.y <= targetY))) this.state.y = targetY;
    return "running";
  }

  protected targetX(environment: MascotEnvironment): number | undefined {
    return this.definition.targetX === undefined ? undefined : Math.trunc(this.values.number("targetX", this.definition.targetX, environment, 0));
  }

  protected targetY(environment: MascotEnvironment): number | undefined {
    return this.definition.targetY === undefined ? undefined : Math.trunc(this.values.number("targetY", this.definition.targetY, environment, 0));
  }
}

class MoveWithTurnRuntime extends MoveRuntime {
  protected override onInit(context: RuntimeContext): void {
    super.onInit(context);
    this.hasTurningAnimation = (this.definition.animations?.length ?? 0) >= 2;
  }

  protected override animation(context: RuntimeContext, turn?: boolean): AnimationDefinition | undefined {
    const animations = this.definition.animations ?? [];
    if (turn) return animations.at(-1);
    const scoped = this.scopedEnvironment(context.environment);
    return animations.slice(0, -1).find((candidate, index) => this.values.boolean(`animation-${index}`, candidate.condition, scoped, true));
  }
}

class TurnRuntime extends AnimatedRuntime {
  private turning = false;

  protected override hasMore(context: RuntimeContext): boolean {
    const desired = this.values.boolean("lookRight", this.definition.lookRight, context.environment, !this.state.lookRight);
    this.turning ||= desired !== this.state.lookRight;
    return this.turning && this.time < this.animationDuration(context);
  }

  protected override tick(context: RuntimeContext): "running" | "lost-ground" {
    this.state.lookRight = this.values.boolean("lookRight", this.definition.lookRight, context.environment, !this.state.lookRight);
    const border = this.applyBorder(context);
    if (border === "lost-ground") return border;
    this.applyAnimation(context);
    return "running";
  }
}

class InstantRuntime extends RuntimeBase {
  public constructor(definition: ActionDefinition, private readonly state: MascotState, random: () => number, private readonly operation: "look" | "offset" | "noop") {
    super(definition, random);
  }

  protected override onInit(context: RuntimeContext): void {
    if (!this.baseHasNext(context)) return;
    if (this.operation === "look") {
      this.state.lookRight = this.values.boolean("lookRight", this.definition.lookRight, context.environment, !this.state.lookRight);
    } else if (this.operation === "offset") {
      this.state.x += Math.trunc(this.values.number("x", this.definition.x, context.environment, 0));
      this.state.y += Math.trunc(this.values.number("y", this.definition.y, context.environment, 0));
    }
  }

  protected override hasMore(): boolean { return false; }
  protected override tick(): "running" { return "running"; }
}

class JumpRuntime extends RuntimeBase {
  public constructor(definition: ActionDefinition, private readonly state: MascotState, random: () => number) { super(definition, random); }

  protected override hasMore(context: RuntimeContext): boolean { return this.distance(context).distance !== 0; }

  protected override tick(context: RuntimeContext): "running" | "lost-ground" {
    const { targetX, targetY, distanceX, distanceY, distance } = this.distance(context);
    this.state.lookRight = this.state.x < targetX;
    const velocity = this.values.number("velocity", this.definition.velocity, context.environment, 20);
    if (distance !== 0) {
      this.state.vx = velocity * distanceX / distance;
      this.state.vy = velocity * distanceY / distance;
      this.state.x += Math.trunc(this.state.vx);
      this.state.y += Math.trunc(this.state.vy);
      const environment = { ...context.environment, targetX, targetY };
      const animation = this.definition.animations?.find((candidate, index) => this.values.boolean(`animation-${index}`, candidate.condition, environment, true));
      const pose = animation && poseAt(animation, this.time);
      if (pose) applyPose(this.state, pose);
    }
    if (distance <= velocity) { this.state.x = targetX; this.state.y = targetY; }
    return "running";
  }

  private distance(context: RuntimeContext): { targetX: number; targetY: number; distanceX: number; distanceY: number; distance: number } {
    const targetX = Math.trunc(this.values.number("targetX", this.definition.targetX, context.environment, 0));
    const targetY = Math.trunc(this.values.number("targetY", this.definition.targetY, context.environment, 0));
    const distanceX = targetX - this.state.x;
    const distanceY = targetY - this.state.y - Math.abs(distanceX) / 2;
    return { targetX, targetY, distanceX, distanceY, distance: Math.hypot(distanceX, distanceY) };
  }
}

class FallRuntime extends RuntimeBase {
  private modX = 0;
  private modY = 0;

  public constructor(definition: ActionDefinition, protected readonly state: MascotState, random: () => number, private readonly defaultGravity: number) {
    super(definition, random);
  }

  protected override onInit(context: RuntimeContext): void {
    this.modX = 0;
    this.modY = 0;
    this.state.vx = Math.trunc(this.values.number("initialVx", this.definition.initialVx, context.environment, 0));
    this.state.vy = Math.trunc(this.values.number("initialVy", this.definition.initialVy, context.environment, 0));
  }

  protected override hasMore(context: RuntimeContext): boolean {
    return !isOnFloor(this.state, context.bounds, context.platforms) && !isOnWall(this.state, context.bounds, this.state.lookRight, context.platforms);
  }

  protected override tick(context: RuntimeContext): "running" | "lost-ground" {
    if (this.state.vx !== 0) this.state.lookRight = this.state.vx > 0;
    const resistanceX = this.values.number("resistanceX", this.definition.resistanceX, context.environment, 0.05);
    const resistanceY = this.values.number("resistanceY", this.definition.resistanceY, context.environment, 0.1);
    const gravity = this.values.number("gravity", this.definition.gravity, context.environment, this.defaultGravity);
    this.state.vx -= this.state.vx * resistanceX;
    this.state.vy = this.state.vy - this.state.vy * resistanceY + gravity;
    this.modX += this.state.vx % 1;
    this.modY += this.state.vy % 1;
    const dx = Math.trunc(this.state.vx) + Math.trunc(this.modX);
    const dy = Math.trunc(this.state.vy) + Math.trunc(this.modY);
    this.modX %= 1;
    this.modY %= 1;
    const divisions = Math.max(1, Math.abs(dx), Math.abs(dy));
    const start = { x: this.state.x, y: this.state.y };
    let stopped = false;
    for (let index = 0; index <= divisions; index += 1) {
      const x = start.x + Math.trunc((dx * index) / divisions);
      const y = start.y + Math.trunc((dy * index) / divisions);
      this.state.x = x;
      this.state.y = y;
      if (dy > 0) {
        for (let offset = -80; offset <= 0; offset += 1) {
          this.state.y = y + offset;
          if (isOnFloor(this.state, context.bounds, context.platforms)) { stopped = true; break; }
        }
        if (stopped) break;
        this.state.y = y;
      }
      if (isOnWall(this.state, context.bounds, this.state.lookRight, context.platforms)) break;
    }
    const fallEnvironment = { ...context.environment, velocityX: this.state.vx, velocityY: this.state.vy };
    const animation = this.definition.animations?.find((candidate, index) => this.values.boolean(`animation-${index}`, candidate.condition, fallEnvironment, true));
    const pose = animation && poseAt(animation, this.time);
    if (pose) applyPose(this.state, pose);
    return "running";
  }
}

function matchingActivePlatform(context: RuntimeContext): PlatformRectangle | undefined {
  const active = context.environment.mascot.environment.activeIE;
  if (!active.visible) return undefined;
  return context.platforms.find((platform) =>
    Math.abs(platform.x - active.x) < 0.001
    && Math.abs(platform.y - active.y) < 0.001
    && Math.abs(platform.width - active.width) < 0.001
    && Math.abs(platform.height - active.height) < 0.001);
}

function carryRelation(state: MascotState, platform: Rectangle, offsetX: number, offsetY: number): boolean {
  const grip = {
    x: state.x + (state.lookRight ? -offsetX : offsetX),
    y: state.y + offsetY,
  };
  return isOnBottom(grip, platform)
    && (state.lookRight ? isOnLeft(grip, platform) : isOnRight(grip, platform));
}

function carriedPlatformPosition(state: MascotState, platform: Rectangle, offsetX: number, offsetY: number): Point {
  return state.lookRight
    ? { x: state.x - offsetX, y: state.y + offsetY - platform.height }
    : { x: state.x + offsetX - platform.width, y: state.y + offsetY - platform.height };
}

class CarryFallRuntime extends FallRuntime {
  private element: HTMLElement | undefined;

  public constructor(definition: ActionDefinition, state: MascotState, random: () => number, gravity: number, private readonly callbacks: ActionExecutorCallbacks) {
    super(definition, state, random, gravity);
  }

  protected override onInit(context: RuntimeContext): void {
    super.onInit(context);
    this.element = matchingActivePlatform(context)?.element;
  }

  protected override tick(context: RuntimeContext): "running" | "lost-ground" {
    const platform = context.platforms.find((candidate) => candidate.element === this.element);
    const offsetX = Math.trunc(this.values.number("ieOffsetX", this.definition.ieOffsetX, context.environment, 0));
    const offsetY = Math.trunc(this.values.number("ieOffsetY", this.definition.ieOffsetY, context.environment, 0));
    if (!platform || !carryRelation(this.state, platform, offsetX, offsetY)) return "lost-ground";
    const result = super.tick(context);
    this.callbacks.movePlatform?.(platform.element, carriedPlatformPosition(this.state, platform, offsetX, offsetY));
    return result;
  }
}

class CarryMoveRuntime extends MoveRuntime {
  private element: HTMLElement | undefined;

  public constructor(definition: ActionDefinition, state: MascotState, random: () => number, private readonly callbacks: ActionExecutorCallbacks) {
    super(definition, state, random);
  }

  protected override onInit(context: RuntimeContext): void {
    super.onInit(context);
    this.element = matchingActivePlatform(context)?.element;
  }

  protected override tick(context: RuntimeContext): "running" | "lost-ground" {
    const platform = context.platforms.find((candidate) => candidate.element === this.element);
    const offsetX = Math.trunc(this.values.number("ieOffsetX", this.definition.ieOffsetX, context.environment, 0));
    const offsetY = Math.trunc(this.values.number("ieOffsetY", this.definition.ieOffsetY, context.environment, 0));
    if (!platform || !carryRelation(this.state, platform, offsetX, offsetY)) return "lost-ground";
    const result = super.tick(context);
    this.callbacks.movePlatform?.(platform.element, carriedPlatformPosition(this.state, platform, offsetX, offsetY));
    return result;
  }
}

class ThrowPlatformRuntime extends AnimateRuntime {
  private element: HTMLElement | undefined;

  public constructor(definition: ActionDefinition, state: MascotState, random: () => number, private readonly callbacks: ActionExecutorCallbacks) {
    super(definition, state, random);
  }

  protected override onInit(context: RuntimeContext): void {
    super.onInit(context);
    this.element = matchingActivePlatform(context)?.element;
  }

  protected override tick(context: RuntimeContext): "running" | "lost-ground" {
    const result = super.tick(context);
    const platform = context.platforms.find((candidate) => candidate.element === this.element);
    if (platform) {
      const vx = Math.trunc(this.values.number("initialVx", this.definition.initialVx, context.environment, 32));
      const vy = Math.trunc(this.values.number("initialVy", this.definition.initialVy, context.environment, -10));
      const gravity = this.values.number("gravity", this.definition.gravity, context.environment, 0.5);
      this.callbacks.movePlatform?.(platform.element, {
        x: platform.x + (this.state.lookRight ? vx : -vx),
        y: platform.y + vy + Math.trunc(this.time * gravity),
      });
    }
    return result;
  }
}

function breed(
  definition: ActionDefinition,
  state: MascotState,
  values: ActionValues,
  context: RuntimeContext,
  callbacks: ActionExecutorCallbacks,
): void {
  const bornX = Math.trunc(values.number("bornX", definition.bornX, context.environment, 0));
  const bornY = Math.trunc(values.number("bornY", definition.bornY, context.environment, 0));
  const count = Math.trunc(values.number("bornCount", definition.bornCount, context.environment, 1));
  if (count < 1) throw new RangeError("BornCount must be positive");
  for (let index = 0; index < count; index += 1) {
    callbacks.spawn({
      x: state.x + (state.lookRight ? -bornX : bornX),
      y: state.y + bornY,
      lookRight: state.lookRight,
      ...(definition.bornBehavior && { behaviorName: definition.bornBehavior }),
    }, definition.bornMascot);
  }
}

class BreedRuntime extends AnimateRuntime {
  private spawned = false;

  public constructor(definition: ActionDefinition, state: MascotState, random: () => number, private readonly callbacks: ActionExecutorCallbacks) {
    super(definition, state, random);
  }

  protected override tick(context: RuntimeContext): "running" | "lost-ground" {
    const result = super.tick(context);
    if (result === "lost-ground") return result;
    const duration = this.animationDuration(context);
    if (!this.spawned && this.time === duration - 1) {
      this.spawned = true;
      breed(this.definition, this.state, this.values, context, this.callbacks);
    }
    return result;
  }
}

class BreedMoveRuntime extends MoveRuntime {
  public constructor(definition: ActionDefinition, state: MascotState, random: () => number, private readonly callbacks: ActionExecutorCallbacks) { super(definition, state, random); }

  protected override tick(context: RuntimeContext): "running" | "lost-ground" {
    const result = super.tick(context);
    if (result === "lost-ground") return result;
    const interval = Math.trunc(this.values.number("bornInterval", this.definition.bornInterval, context.environment, 1));
    if (interval < 1) throw new RangeError("BornInterval must be positive");
    if (this.time % interval === 0 && !this.turning) breed(this.definition, this.state, this.values, context, this.callbacks);
    return result;
  }
}

class BreedJumpRuntime extends JumpRuntime {
  public constructor(definition: ActionDefinition, private readonly breedState: MascotState, random: () => number, private readonly callbacks: ActionExecutorCallbacks) { super(definition, breedState, random); }

  protected override tick(context: RuntimeContext): "running" | "lost-ground" {
    const result = super.tick(context);
    const interval = Math.trunc(this.values.number("bornInterval", this.definition.bornInterval, context.environment, 1));
    if (interval < 1) throw new RangeError("BornInterval must be positive");
    if (this.time % interval === 0) breed(this.definition, this.breedState, this.values, context, this.callbacks);
    return result;
  }
}

class DraggedRuntime extends RuntimeBase {
  private footX = 0;
  private footDx = 0;
  private timeToRegist = 250;

  public constructor(definition: ActionDefinition, private readonly state: MascotState, random: () => number, private readonly spec: CharacterSpec) { super(definition, random); }

  protected override onInit(context: RuntimeContext): void {
    this.footDx = 0;
    this.timeToRegist = 250;
    this.footX = context.environment.mascot.environment.cursor.x + this.offsetX(context);
  }

  protected override hasMore(): boolean { return this.time < this.timeToRegist; }

  protected override tick(context: RuntimeContext): "running" {
    this.state.lookRight = false;
    this.state.dragging = true;
    const cursor = context.environment.mascot.environment.cursor;
    const offsetX = this.offsetX(context);
    const offsetY = this.offsetY(context);
    if (Math.abs(cursor.x - this.state.x + offsetX) >= 5) this.time = 0;
    this.footDx = (this.footDx + (cursor.x - this.footX) * 0.1) * 0.8;
    this.footX += this.footDx;
    const environment = { ...context.environment, footX: this.footX };
    const animation = this.definition.animations?.find((candidate, index) => this.values.boolean(`animation-${index}`, candidate.condition, environment, true));
    const pose = animation && poseAt(animation, this.time);
    if (pose) applyPose(this.state, pose);
    this.state.x = cursor.x + offsetX;
    this.state.y = cursor.y + offsetY;
    if (this.time === this.timeToRegist - 1 && this.values.number(`regist-${this.time}`, "#{Math.random()}", environment, 0) >= 0.1) this.timeToRegist += 1;
    return "running";
  }

  private offsetX(context: RuntimeContext): number {
    const offset = Math.trunc(this.values.number("offsetX", this.definition.offsetX, context.environment, 0));
    return this.definition.offsetType === "Origin" ? -offset + this.spriteCenter().x : offset;
  }

  private offsetY(context: RuntimeContext): number {
    const offset = Math.trunc(this.values.number("offsetY", this.definition.offsetY, context.environment, 120));
    return this.definition.offsetType === "Origin" ? -offset + this.spriteCenter().y : offset;
  }

  private spriteCenter(): Point {
    const sprite = this.spec.sprites[this.state.sprite];
    const width = typeof sprite === "object" ? (sprite.width ?? 128) : 128;
    return { x: this.state.lookRight ? width - this.state.anchorX : this.state.anchorX, y: this.state.anchorY };
  }
}

class RegistRuntime extends AnimatedRuntime {
  public constructor(definition: ActionDefinition, state: MascotState, random: () => number, private readonly spec: CharacterSpec) { super(definition, state, random); }

  protected override hasMore(context: RuntimeContext): boolean {
    const cursor = context.environment.mascot.environment.cursor;
    const rawOffset = Math.trunc(this.values.number("offsetX", this.definition.offsetX, context.environment, 0));
    const sprite = this.spec.sprites[this.state.sprite];
    const width = typeof sprite === "object" ? (sprite.width ?? 128) : 128;
    const centerX = this.state.lookRight ? width - this.state.anchorX : this.state.anchorX;
    const offsetX = this.definition.offsetType === "Origin" ? -rawOffset + centerX : rawOffset;
    return Math.abs(cursor.x - this.state.x + offsetX) < 5;
  }

  protected override tick(context: RuntimeContext): "running" | "lost-ground" {
    this.state.dragging = true;
    this.applyAnimation(context);
    if (this.time + 1 >= this.animationDuration(context)) {
      this.state.lookRight = this.values.number(`look-${this.time}`, "#{Math.random()}", context.environment, 0) < 0.5;
      return "lost-ground";
    }
    return "running";
  }
}

class SelfDestructRuntime extends AnimateRuntime {
  public constructor(definition: ActionDefinition, state: MascotState, random: () => number, private readonly callbacks: ActionExecutorCallbacks) { super(definition, state, random); }
  protected override tick(context: RuntimeContext): "running" | "lost-ground" {
    const result = super.tick(context);
    if (this.time === this.animationDuration(context) - 1) this.callbacks.remove();
    return result;
  }
}

class ComplexRuntime extends RuntimeBase {
  private index = 0;
  private child: Runtime | undefined;
  private selectionMade = false;

  public constructor(
    definition: ActionDefinition,
    random: () => number,
    private readonly factory: (definition: ActionDefinition, context: RuntimeContext) => Runtime,
    private readonly selectOnly: boolean,
  ) { super(definition, random); }

  protected override onInit(context: RuntimeContext): void {
    this.index = 0;
    this.child = undefined;
    this.selectionMade = false;
    if (this.baseHasNext(context)) this.seek(context);
  }

  protected override hasMore(context: RuntimeContext): boolean {
    if (!this.selectOnly) this.seek(context);
    return this.child?.hasNext(context) ?? false;
  }

  protected override tick(context: RuntimeContext): "running" | "lost-ground" {
    return this.child?.hasNext(context) ? this.child.step(context) : "running";
  }

  private seek(context: RuntimeContext): void {
    const definitions = this.definition.actions ?? [];
    if (definitions.length === 0) return;
    for (let guard = 0; guard <= definitions.length; guard += 1) {
      if (this.child?.hasNext(context)) { this.selectionMade = true; return; }
      if (this.selectOnly && this.selectionMade) { this.child = undefined; return; }
      if (this.index >= definitions.length) {
        if (this.definition.loop !== true) { this.child = undefined; return; }
        this.index = 0;
      }
      const definition = definitions[this.index++];
      if (!definition) { this.child = undefined; return; }
      this.child = this.factory(definition, context);
      this.child.init(context);
    }
    this.child = undefined;
  }
}

/** Executes normalized action trees using Shimeji-ee's discrete action lifecycle. */
export class ActionExecutor {
  private runtime: Runtime | undefined;
  private accumulator = 0;
  private readonly random: () => number;

  public constructor(
    private readonly spec: CharacterSpec,
    private readonly state: MascotState,
    private readonly options: ActionExecutorOptions,
    private readonly callbacks: ActionExecutorCallbacks,
  ) { this.random = options.random ?? Math.random; }

  /** Starts the action whose name matches a selected behavior. */
  public start(
    actionName: string,
    environment: MascotEnvironment,
    _preserveLookRight = false,
    bounds: Rectangle = environment.mascot.environment.workArea,
    platforms: readonly PlatformRectangle[] = [],
  ): boolean {
    const definition = this.spec.actions.find((action) => action.name === actionName);
    this.accumulator = 0;
    if (!definition) { this.runtime = undefined; return false; }
    const context = { environment, bounds, platforms };
    this.runtime = this.createRuntime(definition, context, new Set());
    this.runtime.init(context);
    return true;
  }

  /** Advances by elapsed milliseconds and reports completion. */
  public tick(deltaMs: number, environment: MascotEnvironment, bounds: Rectangle, platforms: readonly PlatformRectangle[] = []): boolean {
    this.accumulator += Math.max(0, deltaMs);
    let result: ActionTickResult = this.runtime?.hasNext({ environment, bounds, platforms }) ? "running" : "complete";
    while (this.accumulator >= this.options.frameDuration && result === "running") {
      this.accumulator -= this.options.frameDuration;
      result = this.step(environment, bounds, platforms);
    }
    return result !== "running";
  }

  /** Advances exactly one legacy frame. */
  public step(environment: MascotEnvironment, bounds: Rectangle, platforms: readonly PlatformRectangle[] = []): ActionTickResult {
    const context = { environment, bounds, platforms };
    if (!this.runtime?.hasNext(context)) return "complete";
    const result = this.runtime.step(context);
    if (result === "lost-ground") return result;
    return this.runtime.hasNext(context) ? "running" : "complete";
  }

  /** Returns whether the current action can execute another legacy frame. */
  public hasNext(environment: MascotEnvironment, bounds: Rectangle, platforms: readonly PlatformRectangle[] = []): boolean {
    return this.runtime?.hasNext({ environment, bounds, platforms }) ?? false;
  }

  /** Retained for source compatibility with the previous collision API. */
  public consumeViewportWallCollision(): boolean { return false; }

  /** Cancels the current action tree. */
  public cancel(): void { this.runtime = undefined; this.accumulator = 0; }

  private createRuntime(definition: ActionDefinition, context: RuntimeContext, references: Set<string>): Runtime {
    if (definition.type === "Reference") {
      if (!definition.name || references.has(definition.name)) return new InstantRuntime(definition, this.state, this.random, "noop");
      const referenced = this.spec.actions.find((action) => action.name === definition.name);
      if (!referenced) return new InstantRuntime(definition, this.state, this.random, "noop");
      return this.createRuntime({ ...referenced, ...definition, type: referenced.type, name: definition.name }, context, new Set(references).add(definition.name));
    }
    if (definition.type === "Sequence" || definition.type === "Select") {
      return new ComplexRuntime(definition, this.random, (child, nextContext) => this.createRuntime(child, nextContext, new Set(references)), definition.type === "Select");
    }
    if (definition.type === "Stay") return new StayRuntime(definition, this.state, this.random);
    if (definition.type === "Animate") return new AnimateRuntime(definition, this.state, this.random);
    if (definition.type === "Move") return new MoveRuntime(definition, this.state, this.random);
    switch (definition.embedType) {
      case "Fall": return new FallRuntime(definition, this.state, this.random, this.options.gravity);
      case "FallWithIE": return new CarryFallRuntime(definition, this.state, this.random, this.options.gravity, this.callbacks);
      case "Jump": case "ComplexJump": case "ScanJump": case "BroadcastJump": return new JumpRuntime(definition, this.state, this.random);
      case "WalkWithIE": return new CarryMoveRuntime(definition, this.state, this.random, this.callbacks);
      case "MoveWithTurn": return new MoveWithTurnRuntime(definition, this.state, this.random);
      case "ComplexMove": case "ScanMove": case "BroadcastMove": return new MoveRuntime(definition, this.state, this.random);
      case "Turn": return new TurnRuntime(definition, this.state, this.random);
      case "Look": return new InstantRuntime(definition, this.state, this.random, "look");
      case "Offset": return new InstantRuntime(definition, this.state, this.random, "offset");
      case "Mute": case "Reboot": return new InstantRuntime(definition, this.state, this.random, "noop");
      case "Breed": return new BreedRuntime(definition, this.state, this.random, this.callbacks);
      case "BreedMove": return new BreedMoveRuntime(definition, this.state, this.random, this.callbacks);
      case "BreedJump": return new BreedJumpRuntime(definition, this.state, this.random, this.callbacks);
      case "ThrowIE": return new ThrowPlatformRuntime(definition, this.state, this.random, this.callbacks);
      case "SelfDestruct": case "Exit": return new SelfDestructRuntime(definition, this.state, this.random, this.callbacks);
      case "Dragged": return new DraggedRuntime(definition, this.state, this.random, this.spec);
      case "Regist": return new RegistRuntime(definition, this.state, this.random, this.spec);
      case "Broadcast": case "Interact": case "ScanInteract": case "Transform": return new AnimateRuntime(definition, this.state, this.random);
      case "BroadcastStay": return new StayRuntime(definition, this.state, this.random);
      default: return new StayRuntime(definition, this.state, this.random);
    }
  }
}
