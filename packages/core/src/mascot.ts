import { ActionExecutor } from "./action";
import { BehaviorController } from "./behavior";
import type { DomManager, MascotDomHandle } from "./dom";
import { isOnBottom, isOnFloor, isOnLeft, isOnRight, isOnTop } from "./physics";
import type { PlatformRectangle } from "./platform";
import type { BehaviorDefinition, CharacterSpec, EnvironmentEdge, EnvironmentRectangle, MascotEnvironment, MascotState, Point, Rectangle, ShimejiEngineOptions, SpawnOptions } from "./types";

/** Callbacks through which a mascot communicates with its owning engine. */
export interface MascotCallbacks {
  /** Returns the latest pointer position and velocity in work-area coordinates. */
  pointer(): Point & { dx: number; dy: number };
  /** Returns the current number of live mascots. */
  count(): number;
  /** Requests a sibling mascot. */
  spawn(characterId: string, options: SpawnOptions): void;
  /** Requests removal of this mascot. */
  remove(id: string): void;
  /** Moves a registered platform for legacy IE interaction actions. */
  movePlatform?(element: HTMLElement, point: Point): void;
  /** Reports a click without a drag gesture. */
  click(state: MascotState): void;
  /** Reports a recoverable runtime failure. */
  error(error: Error): void;
}

function edge(predicate: (point: Point) => boolean): EnvironmentEdge { return { isOn: predicate }; }

function environmentRectangle(bounds: Rectangle): EnvironmentRectangle {
  const left = bounds.x;
  const right = bounds.x + bounds.width;
  const top = bounds.y;
  const bottom = bounds.y + bounds.height;
  return {
    x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
    left, right, top, bottom,
    topBorder: edge((point) => isOnTop(point, bounds)),
    leftBorder: edge((point) => isOnLeft(point, bounds)),
    rightBorder: edge((point) => isOnRight(point, bounds)),
    bottomBorder: edge((point) => isOnBottom(point, bounds)),
  };
}

const PLATFORM_NEARBY_DISTANCE = 400;
const PLATFORM_EDGE_TOLERANCE = 2;
function distanceToRectangle(point: Point, rectangle: Rectangle): number {
  const dx = Math.max(rectangle.x - point.x, 0, point.x - rectangle.x - rectangle.width);
  const dy = Math.max(rectangle.y - point.y, 0, point.y - rectangle.y - rectangle.height);
  return Math.hypot(dx, dy);
}

/** Owns one mascot's state machine, interaction listeners, and DOM resource. */
export class Mascot {
  /** Mutable internal state; callers should consume snapshots from the engine. */
  public readonly state: MascotState;
  private readonly domHandle: MascotDomHandle;
  private readonly behavior: BehaviorController;
  private readonly actions: ActionExecutor;
  private readonly disposers: Array<() => void> = [];
  private currentBehavior: BehaviorDefinition | undefined;
  private destroyed = false;
  private dragOffset: Point = { x: 0, y: 0 };
  private pointerId: number | undefined;
  private pointerDown: Point | undefined;
  private lastPointer: Point | undefined;
  private activePlatformElement: HTMLElement | undefined;
  private platforms: readonly PlatformRectangle[] = [];
  private accumulatedMs = 0;
  private readonly frameDuration: number;
  private readonly random: () => number;
  private readonly forceInitialFall: boolean;

  /** Creates a mascot and immediately installs its pointer handlers. */
  public constructor(
    public readonly id: string,
    public readonly spec: CharacterSpec,
    private readonly dom: DomManager,
    options: Required<Pick<ShimejiEngineOptions, "frameDuration" | "gravity" | "mascotClassName">> & { random: (() => number) | undefined },
    spawnOptions: SpawnOptions,
    private readonly callbacks: MascotCallbacks,
  ) {
    const initialPose = spec.actions.flatMap((action) => action.animations ?? []).flatMap((animation) => animation.poses)[0];
    this.state = {
      id,
      characterId: spec.id,
      x: spawnOptions.x ?? 0,
      y: spawnOptions.y ?? 0,
      vx: spawnOptions.vx ?? 0,
      vy: spawnOptions.vy ?? 0,
      sprite: initialPose?.sprite ?? Object.keys(spec.sprites)[0] ?? "",
      anchorX: initialPose?.anchor.x ?? 64,
      anchorY: initialPose?.anchor.y ?? 128,
      lookRight: spawnOptions.lookRight ?? false,
      behaviorName: spawnOptions.behaviorName ?? "Fall",
      dragging: false,
    };
    this.domHandle = dom.createMascot(spec, id, options.mascotClassName || undefined);
    this.frameDuration = options.frameDuration;
    this.random = options.random ?? Math.random;
    this.forceInitialFall = spawnOptions.behaviorName === undefined;
    this.behavior = new BehaviorController(spec, options.random);
    this.actions = new ActionExecutor(spec, this.state, options, {
      spawn: (position, characterId) => this.callbacks.spawn(characterId ?? this.spec.id, position),
      remove: () => this.callbacks.remove(this.id),
      ...(this.callbacks.movePlatform && { movePlatform: this.callbacks.movePlatform }),
    });
    this.installPointerHandlers();
  }

  /** Advances behavior, animation, physics, and rendering by one clock tick. */
  public tick(deltaMs: number, bounds: Rectangle, platforms: readonly PlatformRectangle[] = []): void {
    if (this.destroyed) return;
    this.platforms = platforms;
    try {
      this.ensureBehavior(bounds, platforms, true);
      this.accumulatedMs += Math.max(0, deltaMs);
      while (this.accumulatedMs >= this.frameDuration && !this.destroyed) {
        this.accumulatedMs -= this.frameDuration;
        this.legacyTick(bounds, platforms);
      }
    } catch (error) {
      this.callbacks.error(error instanceof Error ? error : new Error(String(error)));
      this.currentBehavior = undefined;
      this.actions.cancel();
    }
    this.dom.render(this.domHandle, this.spec, this.state);
  }

  /** Returns a detached snapshot safe for application code to retain. */
  public snapshot(): MascotState { return { ...this.state }; }

  /** Removes listeners, DOM nodes, and object URLs owned by this mascot. */
  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.actions.cancel();
    for (const dispose of this.disposers.splice(0)) dispose();
    this.dom.removeMascot(this.domHandle);
  }

  private startBehavior(environment: MascotEnvironment, bounds: Rectangle, platforms: readonly PlatformRectangle[]): boolean {
    if (!this.currentBehavior) return false;
    this.state.behaviorName = this.currentBehavior.name;
    return this.actions.start(this.currentBehavior.actionName ?? this.currentBehavior.name, environment, false, bounds, platforms);
  }

  private ensureBehavior(bounds: Rectangle, platforms: readonly PlatformRectangle[], initial: boolean): void {
    for (let guard = 0; guard < 32 && !this.destroyed; guard += 1) {
      const environment = this.createEnvironment(bounds, platforms);
      if (!this.currentBehavior) {
        this.currentBehavior = initial
          ? this.forceInitialFall
            ? this.findFallBehavior() ?? this.behavior.selectInitial(environment)
            : this.behavior.selectInitial(environment, this.state.behaviorName)
          : this.selectNextBehavior(environment, bounds);
        initial = false;
        if (!this.currentBehavior) this.currentBehavior = this.findFallBehavior();
        if (!this.currentBehavior || !this.startBehavior(environment, bounds, platforms)) return;
      }
      if (this.actions.hasNext(environment, bounds, platforms)) return;
      this.currentBehavior = this.selectNextBehavior(environment, bounds) ?? this.findFallBehavior();
      if (!this.currentBehavior) return;
      if (!this.startBehavior(this.createEnvironment(bounds, platforms), bounds, platforms)) return;
    }
  }

  private legacyTick(bounds: Rectangle, platforms: readonly PlatformRectangle[]): void {
    this.ensureBehavior(bounds, platforms, false);
    if (!this.currentBehavior) return;
    const result = this.actions.step(this.createEnvironment(bounds, platforms), bounds, platforms);
    if (this.destroyed) return;
    if (result === "lost-ground") {
      this.state.dragging = false;
      this.actions.cancel();
      this.currentBehavior = this.selectEdgeBehavior(bounds, platforms);
      if (this.currentBehavior) this.startBehavior(this.createEnvironment(bounds, platforms), bounds, platforms);
    } else if (result === "complete") {
      this.currentBehavior = this.selectNextBehavior(this.createEnvironment(bounds, platforms), bounds);
      if (this.currentBehavior) this.startBehavior(this.createEnvironment(bounds, platforms), bounds, platforms);
      this.ensureBehavior(bounds, platforms, false);
    } else if (this.isOutsideVisibleBounds(bounds)) {
      this.state.x = Math.trunc(bounds.x + this.random() * bounds.width);
      this.state.y = bounds.y - 256;
      this.actions.cancel();
      this.currentBehavior = this.findFallBehavior();
      if (this.currentBehavior) this.startBehavior(this.createEnvironment(bounds, platforms), bounds, platforms);
    }
  }

  private isOutsideVisibleBounds(bounds: Rectangle): boolean {
    const sprite = this.spec.sprites[this.state.sprite];
    const width = typeof sprite === "object" && "width" in sprite && sprite.width !== undefined ? sprite.width : 128;
    const height = typeof sprite === "object" && "height" in sprite && sprite.height !== undefined ? sprite.height : 128;
    const anchorX = this.state.lookRight ? width - this.state.anchorX : this.state.anchorX;
    const left = this.state.x - anchorX;
    const top = this.state.y - this.state.anchorY;
    return left + width <= bounds.x || bounds.x + bounds.width <= left || bounds.y + bounds.height <= top;
  }

  private findFallBehavior(): BehaviorDefinition | undefined {
    return this.behavior.force("Fall") ?? this.behavior.force("落下する");
  }

  private selectNextBehavior(environment: MascotEnvironment, bounds: Rectangle, relocateOnFallback = true): BehaviorDefinition | undefined {
    const selected = this.behavior.selectNext(environment);
    if (relocateOnFallback && this.behavior.usedFallback()) {
      this.state.x = Math.trunc(bounds.x + this.random() * bounds.width);
      this.state.y = bounds.y - 256;
    }
    return selected;
  }

  private selectEdgeBehavior(bounds: Rectangle, platforms: readonly PlatformRectangle[]): BehaviorDefinition | undefined {
    const original = { x: this.state.x, y: this.state.y };
    const platform = platforms.find((candidate) => candidate.element === this.activePlatformElement);
    if (platform) {
      const left = platform.x;
      const right = platform.x + platform.width;
      const top = platform.y;
      const bottom = platform.y + platform.height;
      if (Math.abs(this.state.y - top) <= PLATFORM_EDGE_TOLERANCE || Math.abs(this.state.y - bottom) <= PLATFORM_EDGE_TOLERANCE) {
        if (this.state.x < left) this.state.x = left;
        else if (this.state.x > right) this.state.x = right;
      } else if (Math.abs(this.state.x - left) <= PLATFORM_EDGE_TOLERANCE || Math.abs(this.state.x - right) <= PLATFORM_EDGE_TOLERANCE) {
        if (this.state.y < top) this.state.y = top;
        else if (this.state.y > bottom) this.state.y = bottom;
      }
    }

    const selected = this.selectNextBehavior(this.createEnvironment(bounds, platforms), bounds, false);
    if (this.behavior.usedFallback() || selected?.name === "Fall" || selected?.name === "落下する") {
      this.state.x = original.x;
      this.state.y = original.y;
    }
    return selected ?? this.findFallBehavior();
  }

  private createEnvironment(bounds: Rectangle, platforms: readonly PlatformRectangle[] = this.platforms): MascotEnvironment {
    const workArea = environmentRectangle(bounds);
    const inactive = environmentRectangle({ x: -100, y: -100, width: 0, height: 0 });
    const platform = this.selectActivePlatform(platforms);
    const activeIE = platform
      ? { ...environmentRectangle(platform), visible: true }
      : { ...inactive, visible: false };
    return {
      gap: 0,
      maxCount: 999,
      mascot: {
        totalCount: this.callbacks.count(),
        anchor: { x: this.state.x, y: this.state.y },
        lookRight: this.state.lookRight,
        environment: {
          cursor: this.callbacks.pointer(),
          screen: workArea,
          workArea,
          floor: edge((point) => isOnFloor(point, bounds, platforms)),
          ceiling: edge((point) => isOnTop(point, bounds) || platforms.some((candidate) => isOnBottom(point, candidate))),
          activeIE,
        },
      },
    };
  }

  private selectActivePlatform(platforms: readonly PlatformRectangle[]): PlatformRectangle | undefined {
    if (platforms.length === 0) {
      this.activePlatformElement = undefined;
      return undefined;
    }
    const anchor = this.state;
    const current = platforms.find((platform) => platform.element === this.activePlatformElement);
    if (current && (
      isOnTop(anchor, current, PLATFORM_EDGE_TOLERANCE)
      || isOnBottom(anchor, current, PLATFORM_EDGE_TOLERANCE)
      || isOnLeft(anchor, current, PLATFORM_EDGE_TOLERANCE)
      || isOnRight(anchor, current, PLATFORM_EDGE_TOLERANCE)
    )) return current;

    if (this.state.vy >= 0) {
      const landingPlatform = platforms
        .filter((platform) => anchor.x >= platform.x && anchor.x <= platform.x + platform.width && platform.y >= anchor.y - 1)
        .sort((left, right) => left.y - right.y)[0];
      if (landingPlatform) {
        this.activePlatformElement = landingPlatform.element;
        return landingPlatform;
      }
    }

    const nearby = [...platforms]
      .map((platform) => ({ platform, distance: distanceToRectangle(anchor, platform) }))
      .filter(({ distance }) => distance <= PLATFORM_NEARBY_DISTANCE)
      .sort((left, right) => left.distance - right.distance)[0]?.platform;
    this.activePlatformElement = nearby?.element;
    return nearby;
  }

  private installPointerHandlers(): void {
    const element = this.domHandle.spriteElement;
    const document = element.ownerDocument;
    const listen = <K extends keyof HTMLElementEventMap>(target: EventTarget, type: K, listener: (event: HTMLElementEventMap[K]) => void): void => {
      target.addEventListener(type, listener as EventListener);
      this.disposers.push(() => target.removeEventListener(type, listener as EventListener));
    };
    listen(element, "pointerdown", (event) => {
      const pointerEvent = event as PointerEvent;
      if (pointerEvent.button !== 0) return;
      event.preventDefault();
      const point = this.dom.toLocalPoint(pointerEvent.clientX, pointerEvent.clientY);
      this.pointerId = pointerEvent.pointerId;
      this.pointerDown = point;
      this.lastPointer = point;
      this.dragOffset = { x: this.state.x - point.x, y: this.state.y - point.y };
      this.state.dragging = true;
      this.currentBehavior = this.behavior.force("Dragged") ?? this.behavior.force("ドラッグされる");
      if (this.currentBehavior) this.startBehavior(this.createEnvironment(this.dom.getBounds()), this.dom.getBounds(), this.platforms);
      element.setPointerCapture?.(pointerEvent.pointerId);
    });
    listen(document, "pointermove", (event) => {
      const pointerEvent = event as PointerEvent;
      if (!this.state.dragging || pointerEvent.pointerId !== this.pointerId) return;
      const point = this.dom.toLocalPoint(pointerEvent.clientX, pointerEvent.clientY);
      const previous = this.lastPointer ?? point;
      const bounds = this.dom.getBounds();
      this.state.vx = (point.x - previous.x) * 0.8;
      this.state.vy = (point.y - previous.y) * 0.8;
      this.state.x = point.x + this.dragOffset.x;
      this.state.y = point.y + this.dragOffset.y;
      this.lastPointer = point;
    });
    listen(document, "pointerup", (event) => {
      const pointerEvent = event as PointerEvent;
      if (!this.state.dragging || pointerEvent.pointerId !== this.pointerId) return;
      this.state.dragging = false;
      const moved = this.pointerDown ? Math.hypot(this.lastPointer!.x - this.pointerDown.x, this.lastPointer!.y - this.pointerDown.y) : 0;
      this.pointerId = undefined;
      this.currentBehavior = this.behavior.force("Thrown") ?? this.behavior.force("投げられる") ?? this.findFallBehavior();
      if (this.currentBehavior) {
        const bounds = this.dom.getBounds();
        this.startBehavior(this.createEnvironment(bounds), bounds, this.platforms);
      }
      if (moved < 4) this.callbacks.click(this.snapshot());
    });
  }
}
