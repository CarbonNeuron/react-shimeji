import { SpriteManager, type SpriteLease } from "./sprite";
import type { CharacterSpec, MascotState, Rectangle } from "./types";

/** DOM nodes and resources owned by one mascot. */
export interface MascotDomHandle {
  /** Pointer-interactive mascot wrapper. */
  element: HTMLDivElement;
  /** Child element on which sprite images are painted. */
  spriteElement: HTMLDivElement;
  /** Per-mascot spritesheet URL lease. */
  spriteLease: SpriteLease;
}

/** Creates and updates all DOM owned by an engine instance. */
export class DomManager {
  /** Generated element that contains all mascots. */
  public readonly workArea: HTMLDivElement;

  /** Creates an isolated work area inside the supplied host element. */
  public constructor(
    private readonly container: HTMLElement,
    private readonly sprites: SpriteManager,
    workAreaClassName?: string,
  ) {
    const workArea = document.createElement("div");
    workArea.dataset.reactShimejiWorkArea = "true";
    if (workAreaClassName) workArea.className = workAreaClassName;
    Object.assign(workArea.style, {
      position: "absolute", inset: "0", width: "100%", height: "100%",
      overflow: "hidden", pointerEvents: "none", zIndex: "2147483643",
    });
    this.workArea = workArea;
    this.ensureMounted();
  }

  /** Reattaches the work area if application code temporarily removed it. */
  public ensureMounted(): void {
    if (this.workArea.parentElement !== this.container) this.container.appendChild(this.workArea);
  }

  /** Returns the current local work-area rectangle. */
  public getBounds(): Rectangle {
    return this.getBoundsFromClientRectangle(this.workArea.getBoundingClientRect());
  }

  /** Converts a previously-read work-area client rectangle into local bounds. */
  public getBoundsFromClientRectangle(rectangle: Pick<DOMRect, "width" | "height">): Rectangle {
    const width = rectangle.width || this.container.clientWidth || window.innerWidth;
    const height = rectangle.height || this.container.clientHeight || window.innerHeight;
    return { x: 0, y: 0, width, height };
  }

  /** Creates a mascot node and acquires its spritesheet resource. */
  public createMascot(spec: CharacterSpec, mascotId: string, mascotClassName?: string): MascotDomHandle {
    const spriteLease = this.sprites.acquire(spec.spritesheet);
    const element = document.createElement("div");
    element.dataset.shimejiId = mascotId;
    if (mascotClassName) element.className = mascotClassName;
    Object.assign(element.style, { position: "absolute", left: "0", top: "0", width: "0", height: "0", pointerEvents: "auto", touchAction: "none", userSelect: "none", willChange: "transform" });
    const spriteElement = document.createElement("div");
    Object.assign(spriteElement.style, { position: "absolute", left: "0", top: "0", backgroundRepeat: "no-repeat", transformOrigin: "center center", pointerEvents: "none" });
    element.appendChild(spriteElement);
    this.workArea.appendChild(element);
    return { element, spriteElement, spriteLease };
  }

  /** Paints one mascot state into its existing DOM nodes. */
  public render(handle: MascotDomHandle, spec: CharacterSpec, state: MascotState): void {
    const sprite = this.sprites.resolve(spec, handle.spriteLease, state.sprite);
    handle.element.style.transform = `translate3d(${state.x - state.anchorX}px, ${state.y - state.anchorY}px, 0)`;
    handle.spriteElement.style.left = "0";
    handle.spriteElement.style.top = "0";
    handle.spriteElement.style.transform = `scaleX(${state.lookRight ? -1 : 1})`;
    if (!sprite) return;
    handle.spriteElement.style.backgroundImage = `url("${sprite.url.replaceAll('"', '\\"')}")`;
    if (sprite.rectangle) {
      handle.spriteElement.style.width = `${sprite.rectangle.width}px`;
      handle.spriteElement.style.height = `${sprite.rectangle.height}px`;
      handle.element.style.width = `${sprite.rectangle.width}px`;
      handle.element.style.height = `${sprite.rectangle.height}px`;
      handle.spriteElement.style.backgroundPosition = `${-sprite.rectangle.x}px ${-sprite.rectangle.y}px`;
      handle.spriteElement.style.backgroundSize = "auto";
    } else {
      handle.spriteElement.style.backgroundPosition = "0 0";
      handle.spriteElement.style.backgroundSize = "contain";
      handle.spriteElement.style.width = "128px";
      handle.spriteElement.style.height = "128px";
      const definition = Object.values(spec.sprites).find((candidate) => typeof candidate === "object" && "url" in candidate && candidate.url === sprite.url);
      if (typeof definition === "object" && "width" in definition && definition.width !== undefined) handle.spriteElement.style.width = `${definition.width}px`;
      if (typeof definition === "object" && "height" in definition && definition.height !== undefined) handle.spriteElement.style.height = `${definition.height}px`;
      handle.element.style.width = handle.spriteElement.style.width;
      handle.element.style.height = handle.spriteElement.style.height;
    }
  }

  /** Removes one mascot node and releases its temporary image URL. */
  public removeMascot(handle: MascotDomHandle): void {
    handle.element.remove();
    handle.spriteLease.release();
  }

  /** Removes the work area owned by this manager. */
  public destroy(): void { this.workArea.remove(); }
}
