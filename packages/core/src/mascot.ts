import { ActionExecutor } from "./action";
import { BehaviorController } from "./behavior";
import type { DomManager, MascotDomHandle } from "./dom";
import { isOnBottom, isOnLeft, isOnRight, isOnTop } from "./physics";
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
const PLATFORM_EDGE_TOLERANCE = 16;

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
    this.behavior = new BehaviorController(spec, options.random);
    this.actions = new ActionExecutor(spec, this.state, options, {
      spawn: (position) => this.callbacks.spawn(this.spec.id, position),
      remove: () => this.callbacks.remove(this.id),
    });
    this.installPointerHandlers();
  }

  /** Advances behavior, animation, physics, and rendering by one clock tick. */
  public tick(deltaMs: number, bounds: Rectangle, platforms: readonly PlatformRectangle[] = []): void {
    if (this.destroyed) return;
    this.platforms = platforms;
    const environment = this.createEnvironment(bounds, platforms);
    if (this.state.dragging) { this.dom.render(this.domHandle, this.spec, this.state); return; }
    try {
      for (let guard = 0; guard < 8; guard += 1) {
        if (!this.currentBehavior) {
          this.currentBehavior = this.behavior.selectInitial(environment, this.state.behaviorName);
          let started = this.startBehavior(environment);
          if (!started) {
            this.currentBehavior = this.findFallBehavior();
            started = this.startBehavior(environment);
          }
          if (!started) break;
        }
        const activeIE = environment.mascot.environment.activeIE;
        const wasOnPlatformTop = activeIE.visible && activeIE.topBorder.isOn(this.state);
        const completed = this.actions.tick(deltaMs, environment, bounds);
        const remainedNearPlatform = this.state.x >= activeIE.left - PLATFORM_EDGE_TOLERANCE
          && this.state.x <= activeIE.right + PLATFORM_EDGE_TOLERANCE;
        if (wasOnPlatformTop
          && !remainedNearPlatform
          && !platforms.some((platform) => isOnTop(this.state, platform))) {
          this.actions.cancel();
          this.currentBehavior = this.findFallBehavior();
          if (this.currentBehavior) this.startBehavior(this.createEnvironment(bounds, platforms));
          break;
        }
        if (!completed) break;
        if (this.destroyed) return;
        this.currentBehavior = this.behavior.selectNext(this.createEnvironment(bounds, platforms));
        if (!this.currentBehavior || !this.startBehavior(this.createEnvironment(bounds, platforms))) {
          this.currentBehavior = this.findFallBehavior();
          if (!this.currentBehavior || !this.startBehavior(this.createEnvironment(bounds, platforms))) break;
        }
        deltaMs = 0;
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

  private startBehavior(environment: MascotEnvironment): boolean {
    if (!this.currentBehavior) return false;
    this.state.behaviorName = this.currentBehavior.name;
    return this.actions.start(this.currentBehavior.name, environment);
  }

  private findFallBehavior(): BehaviorDefinition | undefined {
    return this.behavior.force("Fall") ?? this.behavior.force("落下する");
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
          screen: { width: window.innerWidth, height: window.innerHeight },
          workArea,
          floor: workArea.bottomBorder,
          ceiling: workArea.topBorder,
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
      isOnTop(anchor, current, 2)
      || isOnBottom(anchor, current, 2)
      || isOnLeft(anchor, current, 2)
      || isOnRight(anchor, current, 2)
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
    const listen = <K extends keyof HTMLElementEventMap>(target: EventTarget, type: K, listener: (event: HTMLElementEventMap[K]) => void): void => {
      target.addEventListener(type, listener as EventListener);
      this.disposers.push(() => target.removeEventListener(type, listener as EventListener));
    };
    listen(element, "pointerdown", (event) => {
      const pointerEvent = event as PointerEvent;
      if (pointerEvent.button !== 0) return;
      event.preventDefault();
      const point = { x: pointerEvent.clientX, y: pointerEvent.clientY };
      this.pointerId = pointerEvent.pointerId;
      this.pointerDown = point;
      this.lastPointer = point;
      this.dragOffset = { x: this.state.x - point.x, y: this.state.y - point.y };
      this.state.dragging = true;
      this.actions.cancel();
      this.currentBehavior = this.behavior.force("Dragged") ?? this.behavior.force("ドラッグされる");
      if (this.currentBehavior) this.state.behaviorName = this.currentBehavior.name;
      element.setPointerCapture?.(pointerEvent.pointerId);
    });
    listen(document, "pointermove", (event) => {
      const pointerEvent = event as PointerEvent;
      if (!this.state.dragging || pointerEvent.pointerId !== this.pointerId) return;
      const point = { x: pointerEvent.clientX, y: pointerEvent.clientY };
      const previous = this.lastPointer ?? point;
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
        this.state.behaviorName = this.currentBehavior.name;
        this.actions.start(this.currentBehavior.name, this.createEnvironment(this.dom.getBounds()));
      }
      if (moved < 4) this.callbacks.click(this.snapshot());
    });
  }
}
