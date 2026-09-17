import { DomManager } from "./dom";
import { normalizeCharacterSpec } from "./loader";
import { Mascot } from "./mascot";
import { readPlatformRectangles, resolvePlatformElements, type PlatformRectangle } from "./platform";
import { SpriteManager } from "./sprite";
import type { CharacterSpec, MascotState, ShimejiEngineEventMap, ShimejiEngineOptions, ShimejiEventListener, SpawnOptions } from "./types";

class EventEmitter<Events extends object> {
  private readonly listeners = new Map<keyof Events, Set<(payload: never) => void>>();
  public on<K extends keyof Events>(event: K, listener: (payload: Events[K]) => void): () => void {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener as (payload: never) => void);
    this.listeners.set(event, listeners);
    return () => { listeners.delete(listener as (payload: never) => void); };
  }
  public emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(payload as never);
  }
  public clear(): void { this.listeners.clear(); }
}

const defaults = {
  frameDuration: 40,
  gravity: 2,
  maxDeltaTime: 100,
  workAreaClassName: "",
  mascotClassName: "",
  platforms: [] as readonly HTMLElement[],
} as const;

type ResolvedEngineOptions = Required<Omit<ShimejiEngineOptions, "random">> & { random: (() => number) | undefined };

/** Framework-agnostic manager for character registration and live Shimeji mascots. */
export class ShimejiEngine {
  private readonly specs = new Map<string, CharacterSpec>();
  private readonly mascots = new Map<string, Mascot>();
  private readonly sprites = new SpriteManager();
  private readonly dom: DomManager;
  private readonly events = new EventEmitter<ShimejiEngineEventMap>();
  private readonly disposers: Array<() => void> = [];
  private readonly intervals = new Set<number>();
  private readonly options: ResolvedEngineOptions;
  private pointer = { x: 0, y: 0, dx: 0, dy: 0 };
  private animationFrame: number | undefined;
  private lastFrameTime: number | undefined;
  private nextMascotId = 1;
  private destroyed = false;
  private initialized = false;
  private platformSource: string | readonly HTMLElement[];
  private additionalPlatformElements: readonly HTMLElement[] = [];
  private readonly movedPlatforms = new Map<HTMLElement, { originalTransform: string; x: number; y: number }>();
  private readonly platformRectangles = new Map<HTMLElement, PlatformRectangle>();

  /** Creates and initializes an engine inside a host DOM element. */
  public constructor(private readonly container: HTMLElement, options: ShimejiEngineOptions = {}) {
    if (!container) throw new TypeError("ShimejiEngine requires a container element");
    this.options = { ...defaults, ...options, random: options.random };
    this.platformSource = this.options.platforms;
    this.dom = new DomManager(container, this.sprites);
    this.initialize();
  }

  /** Starts the clock and container-aware listeners. Calling this method more than once is harmless. */
  public initialize(): void {
    this.assertAlive();
    if (this.initialized) return;
    this.initialized = true;
    const document = this.container.ownerDocument;
    const view = document.defaultView;
    if (!view) throw new Error("ShimejiEngine requires a container connected to a window");
    this.listen(document, "pointermove", (event) => {
      const pointerEvent = event as PointerEvent;
      const { x, y } = this.dom.toLocalPoint(pointerEvent.clientX, pointerEvent.clientY);
      this.pointer = { x, y, dx: x - this.pointer.x, dy: y - this.pointer.y };
    });
    this.listen(view, "resize", () => this.renderAll());
    const maintenance = view.setInterval(() => this.dom.ensureMounted(), 2_000);
    this.intervals.add(maintenance);
    this.animationFrame = view.requestAnimationFrame(this.onAnimationFrame);
  }

  /** Registers or replaces a parsed or legacy character specification. */
  public registerCharacter(spec: CharacterSpec | unknown): string {
    this.assertAlive();
    const normalized = normalizeCharacterSpec(spec);
    this.specs.set(normalized.id, normalized);
    return normalized.id;
  }

  /** Unregisters a character and optionally removes all of its live mascots. */
  public unregisterCharacter(characterId: string, removeMascots = true): boolean {
    this.assertAlive();
    if (removeMascots) {
      for (const state of this.getState()) if (state.characterId === characterId) this.remove(state.id);
    }
    return this.specs.delete(characterId);
  }

  /** Returns identifiers for all currently registered characters. */
  public getCharacterIds(): string[] { return [...this.specs.keys()]; }

  /** Creates a mascot from a registered character and returns its instance id. */
  public spawn(characterId: string, position: SpawnOptions = {}): string {
    this.assertAlive();
    const spec = this.specs.get(characterId);
    if (!spec) throw new Error(`Character '${characterId}' is not registered`);
    const { bounds, platforms } = this.readFrameGeometry();
    const random = this.options.random ?? Math.random;
    const randomX = Math.trunc(bounds.x + random() * bounds.width);
    const spawnInset = Math.min(2, bounds.width / 2);
    const spawnOptions: SpawnOptions = {
      ...position,
      // Fall treats the wall in the facing direction as ground. Keep implicit
      // spawns clear of both side-wall tolerances so even random() === 0 falls.
      x: position.x ?? Math.min(Math.max(randomX, bounds.x + spawnInset), bounds.x + bounds.width - spawnInset),
      y: position.y ?? bounds.y + 2,
    };
    const id = `shimeji-${this.nextMascotId++}`;
    const mascot = new Mascot(id, spec, this.dom, this.options, spawnOptions, {
      pointer: () => ({ ...this.pointer }),
      count: () => this.mascots.size,
      spawn: (nextCharacterId, nextPosition) => { if (!this.destroyed) this.spawn(nextCharacterId, nextPosition); },
      remove: (mascotId) => { if (!this.destroyed) this.remove(mascotId); },
      movePlatform: (element, point) => this.movePlatform(element, point),
      click: (state) => this.events.emit("click", state),
      error: (error) => this.events.emit("error", error),
    });
    this.mascots.set(id, mascot);
    mascot.tick(0, bounds, platforms);
    const state = mascot.snapshot();
    this.events.emit("spawn", state);
    this.emitState();
    return id;
  }

  /** Removes one mascot and all resources associated with it. */
  public remove(mascotId: string): boolean {
    this.assertAlive();
    const mascot = this.mascots.get(mascotId);
    if (!mascot) return false;
    const state = mascot.snapshot();
    this.mascots.delete(mascotId);
    mascot.destroy();
    this.events.emit("remove", state);
    this.emitState();
    return true;
  }

  /** Removes every live mascot while leaving registered character specs available. */
  public removeAll(): void {
    this.assertAlive();
    for (const id of [...this.mascots.keys()]) this.remove(id);
  }

  /** Returns detached snapshots of every live mascot. */
  public getState(): MascotState[] { return [...this.mascots.values()].map((mascot) => mascot.snapshot()); }

  /** Subscribes to a typed engine event and returns an unsubscribe function. */
  public on<K extends keyof ShimejiEngineEventMap>(event: K, listener: ShimejiEventListener<K>): () => void {
    this.assertAlive();
    return this.events.on(event, listener);
  }

  /** Replaces the primary platform source and any additional registered elements. */
  public setPlatforms(platforms: string | readonly HTMLElement[], additionalPlatforms: readonly HTMLElement[] = []): void {
    this.assertAlive();
    this.platformSource = platforms;
    this.additionalPlatformElements = additionalPlatforms;
  }

  /** Stops animation and timers, removes listeners and DOM, and revokes all object URLs. */
  public destroy(): void {
    if (this.destroyed) return;
    for (const mascot of this.mascots.values()) mascot.destroy();
    this.mascots.clear();
    const view = this.container.ownerDocument.defaultView;
    if (this.animationFrame !== undefined) view?.cancelAnimationFrame(this.animationFrame);
    this.animationFrame = undefined;
    for (const interval of this.intervals) view?.clearInterval(interval);
    this.intervals.clear();
    for (const dispose of this.disposers.splice(0)) dispose();
    this.dom.destroy();
    for (const [element, movement] of this.movedPlatforms) element.style.transform = movement.originalTransform;
    this.movedPlatforms.clear();
    this.platformRectangles.clear();
    this.sprites.destroy();
    this.specs.clear();
    this.events.clear();
    this.destroyed = true;
    this.initialized = false;
  }

  /** Returns whether this engine has completed permanent teardown. */
  public isDestroyed(): boolean { return this.destroyed; }

  private readonly onAnimationFrame = (timestamp: number): void => {
    if (this.destroyed) return;
    const rawDelta = this.lastFrameTime === undefined ? this.options.frameDuration : timestamp - this.lastFrameTime;
    this.lastFrameTime = timestamp;
    const delta = Math.max(0, Math.min(rawDelta, this.options.maxDeltaTime));
    const { bounds, platforms } = this.readFrameGeometry();
    for (const mascot of [...this.mascots.values()]) mascot.tick(delta, bounds, platforms);
    this.emitState();
    this.animationFrame = this.container.ownerDocument.defaultView?.requestAnimationFrame(this.onAnimationFrame);
  };

  private renderAll(): void {
    const { bounds, platforms } = this.readFrameGeometry();
    for (const mascot of this.mascots.values()) mascot.tick(0, bounds, platforms);
  }

  private readFrameGeometry(): { bounds: ReturnType<DomManager["getBounds"]>; platforms: PlatformRectangle[] } {
    const bounds = this.dom.getBounds();
    const elements = [...new Set([
      ...resolvePlatformElements(this.platformSource, this.container),
      ...resolvePlatformElements(this.additionalPlatformElements, this.container),
    ])].filter((element) => !this.dom.owns(element));
    const platforms = readPlatformRectangles(elements, this.container.getBoundingClientRect());
    this.platformRectangles.clear();
    for (const platform of platforms) this.platformRectangles.set(platform.element, platform);
    return { bounds, platforms };
  }

  private movePlatform(element: HTMLElement, point: { x: number; y: number }): void {
    const rectangle = this.platformRectangles.get(element);
    if (!rectangle) return;
    const movement = this.movedPlatforms.get(element) ?? { originalTransform: element.style.transform, x: 0, y: 0 };
    movement.x += point.x - rectangle.x;
    movement.y += point.y - rectangle.y;
    const translate = `translate(${movement.x}px, ${movement.y}px)`;
    element.style.transform = movement.originalTransform ? `${movement.originalTransform} ${translate}` : translate;
    rectangle.x = point.x;
    rectangle.y = point.y;
    this.movedPlatforms.set(element, movement);
  }

  private emitState(): void { this.events.emit("statechange", this.getState()); }

  private listen(target: EventTarget, type: string, listener: EventListener): void {
    target.addEventListener(type, listener);
    this.disposers.push(() => target.removeEventListener(type, listener));
  }

  private assertAlive(): void {
    if (this.destroyed) throw new Error("ShimejiEngine has been destroyed");
  }
}
