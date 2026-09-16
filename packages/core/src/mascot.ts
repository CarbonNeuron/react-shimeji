import { ActionExecutor } from "./action";
import { BehaviorController } from "./behavior";
import type { DomManager, MascotDomHandle } from "./dom";
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
    ...bounds, left, right, top, bottom,
    topBorder: edge((point) => Math.abs(point.y - top) <= 1),
    leftBorder: edge((point) => Math.abs(point.x - left) <= 1),
    rightBorder: edge((point) => Math.abs(point.x - right) <= 1),
    bottomBorder: edge((point) => Math.abs(point.y - bottom) <= 1),
  };
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
  public tick(deltaMs: number, bounds: Rectangle): void {
    if (this.destroyed) return;
    const environment = this.createEnvironment(bounds);
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
        if (!this.actions.tick(deltaMs, environment, bounds)) break;
        if (this.destroyed) return;
        this.currentBehavior = this.behavior.selectNext(this.createEnvironment(bounds));
        if (!this.currentBehavior || !this.startBehavior(this.createEnvironment(bounds))) {
          this.currentBehavior = this.findFallBehavior();
          if (!this.currentBehavior || !this.startBehavior(this.createEnvironment(bounds))) break;
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

  private createEnvironment(bounds: Rectangle): MascotEnvironment {
    const workArea = environmentRectangle(bounds);
    const inactive = environmentRectangle({ x: -100, y: -100, width: 0, height: 0 });
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
          activeIE: { ...inactive, visible: false },
        },
      },
    };
  }

  private installPointerHandlers(): void {
    const element = this.domHandle.element;
    const listen = <K extends keyof HTMLElementEventMap>(target: EventTarget, type: K, listener: (event: HTMLElementEventMap[K]) => void): void => {
      target.addEventListener(type, listener as EventListener);
      this.disposers.push(() => target.removeEventListener(type, listener as EventListener));
    };
    listen(element, "pointerdown", (event) => {
      const pointerEvent = event as PointerEvent;
      if (pointerEvent.button !== 0) return;
      event.preventDefault();
      const bounds = this.dom.workArea.getBoundingClientRect();
      const point = { x: pointerEvent.clientX - bounds.left, y: pointerEvent.clientY - bounds.top };
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
      const bounds = this.dom.workArea.getBoundingClientRect();
      const point = { x: pointerEvent.clientX - bounds.left, y: pointerEvent.clientY - bounds.top };
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
