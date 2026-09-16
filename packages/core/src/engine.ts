import { DomManager } from "./dom";
import { normalizeCharacterSpec } from "./loader";
import { Mascot } from "./mascot";
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
  private readonly originalContainerPosition: string;
  private readonly adjustedContainerPosition: boolean;
  private pointer = { x: 0, y: 0, dx: 0, dy: 0 };
  private animationFrame: number | undefined;
  private lastFrameTime: number | undefined;
  private nextMascotId = 1;
  private destroyed = false;
  private initialized = false;

  /** Creates and initializes an engine inside a host DOM element. */
  public constructor(private readonly container: HTMLElement, options: ShimejiEngineOptions = {}) {
    if (!container) throw new TypeError("ShimejiEngine requires a container element");
    this.options = { ...defaults, ...options, random: options.random };
    this.originalContainerPosition = container.style.position;
    this.adjustedContainerPosition = getComputedStyle(container).position === "static";
    if (this.adjustedContainerPosition) container.style.position = "relative";
    this.dom = new DomManager(container, this.sprites, this.options.workAreaClassName || undefined);
    this.initialize();
  }

  /** Starts the clock and global listeners. Calling this method more than once is harmless. */
  public initialize(): void {
    this.assertAlive();
    if (this.initialized) return;
    this.initialized = true;
    this.listen(document, "pointermove", (event) => {
      const pointerEvent = event as PointerEvent;
      const rectangle = this.dom.workArea.getBoundingClientRect();
      const x = pointerEvent.clientX - rectangle.left;
      const y = pointerEvent.clientY - rectangle.top;
      this.pointer = { x, y, dx: x - this.pointer.x, dy: y - this.pointer.y };
    });
    this.listen(window, "resize", () => this.renderAll());
    const maintenance = window.setInterval(() => this.dom.ensureMounted(), 2_000);
    this.intervals.add(maintenance);
    this.animationFrame = requestAnimationFrame(this.onAnimationFrame);
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
    const bounds = this.dom.getBounds();
    const random = this.options.random ?? Math.random;
    const spawnOptions: SpawnOptions = {
      ...position,
      x: position.x ?? bounds.x + random() * bounds.width,
      y: position.y ?? bounds.y + random() * bounds.height,
    };
    const id = `shimeji-${this.nextMascotId++}`;
    const mascot = new Mascot(id, spec, this.dom, this.options, spawnOptions, {
      pointer: () => ({ ...this.pointer }),
      count: () => this.mascots.size,
      spawn: (nextCharacterId, nextPosition) => { if (!this.destroyed) this.spawn(nextCharacterId, nextPosition); },
      remove: (mascotId) => { if (!this.destroyed) this.remove(mascotId); },
      click: (state) => this.events.emit("click", state),
      error: (error) => this.events.emit("error", error),
    });
    this.mascots.set(id, mascot);
    mascot.tick(0, bounds);
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

  /** Stops animation and timers, removes listeners and DOM, and revokes all object URLs. */
  public destroy(): void {
    if (this.destroyed) return;
    for (const mascot of this.mascots.values()) mascot.destroy();
    this.mascots.clear();
    if (this.animationFrame !== undefined) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = undefined;
    for (const interval of this.intervals) window.clearInterval(interval);
    this.intervals.clear();
    for (const dispose of this.disposers.splice(0)) dispose();
    this.dom.destroy();
    this.sprites.destroy();
    this.specs.clear();
    this.events.clear();
    if (this.adjustedContainerPosition && this.container.style.position === "relative") this.container.style.position = this.originalContainerPosition;
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
    const bounds = this.dom.getBounds();
    for (const mascot of [...this.mascots.values()]) mascot.tick(delta, bounds);
    this.emitState();
    this.animationFrame = requestAnimationFrame(this.onAnimationFrame);
  };

  private renderAll(): void {
    const bounds = this.dom.getBounds();
    for (const mascot of this.mascots.values()) mascot.tick(0, bounds);
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
