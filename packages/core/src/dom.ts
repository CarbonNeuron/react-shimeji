import { SpriteManager, type SpriteLease } from "./sprite";
import type { CharacterSpec, MascotState, Rectangle } from "./types";

/** DOM nodes and resources owned by one mascot. */
export interface MascotDomHandle {
  /** Absolutely positioned, pointer-transparent mascot wrapper. */
  element: HTMLDivElement;
  /** Pointer-interactive child element on which sprite images are painted. */
  spriteElement: HTMLDivElement;
  /** Per-mascot spritesheet URL lease. */
  spriteLease: SpriteLease;
}

/** Creates and updates all DOM owned by an engine instance. */
export class DomManager {
  private readonly handles = new Set<MascotDomHandle>();
  private readonly restoreContainerStyles: Array<() => void> = [];

  /** Uses the supplied element as the containing block and clipping boundary. */
  public constructor(
    private readonly container: HTMLElement,
    private readonly sprites: SpriteManager,
  ) {
    const view = container.ownerDocument.defaultView;
    const computedStyle = view?.getComputedStyle(container);
    if (!computedStyle?.position || computedStyle.position === "static") this.applyContainerStyle("position", "relative");
    if (computedStyle?.overflowX === "visible" || !computedStyle?.overflowX) {
      this.applyContainerStyle("overflowX", "clip");
    }
  }

  /** Reattaches mascot elements if application code temporarily removed them. */
  public ensureMounted(): void {
    for (const handle of this.handles) {
      if (handle.element.parentElement !== this.container) this.container.appendChild(handle.element);
    }
  }

  /** Returns bounds in the container-local coordinate system. */
  public getBounds(): Rectangle {
    return { x: 0, y: 0, width: this.container.clientWidth, height: this.container.clientHeight };
  }

  /** Converts a viewport client coordinate into container-local coordinates. */
  public toLocalPoint(clientX: number, clientY: number): { x: number; y: number } {
    const rectangle = this.container.getBoundingClientRect();
    return { x: clientX - rectangle.left, y: clientY - rectangle.top };
  }

  /** Creates a mascot node and acquires its spritesheet resource. */
  public createMascot(spec: CharacterSpec, mascotId: string, mascotClassName?: string): MascotDomHandle {
    const spriteLease = this.sprites.acquire(spec.spritesheet);
    const element = this.container.ownerDocument.createElement("div");
    element.dataset.shimejiId = mascotId;
    element.setAttribute("aria-hidden", "true");
    if (mascotClassName) element.className = mascotClassName;
    Object.assign(element.style, { position: "absolute", left: "0", top: "0", width: "0", height: "0", pointerEvents: "none", zIndex: "9999", userSelect: "none", willChange: "transform" });
    const spriteElement = this.container.ownerDocument.createElement("div");
    Object.assign(spriteElement.style, { position: "absolute", left: "0", top: "0", backgroundRepeat: "no-repeat", transformOrigin: "center center", pointerEvents: "auto", touchAction: "none", userSelect: "none" });
    element.appendChild(spriteElement);
    const handle = { element, spriteElement, spriteLease };
    this.handles.add(handle);
    this.container.appendChild(element);
    return handle;
  }

  /** Paints one mascot state into its existing DOM nodes. */
  public render(handle: MascotDomHandle, spec: CharacterSpec, state: MascotState): void {
    const sprite = this.sprites.resolve(spec, handle.spriteLease, state.sprite);
    handle.spriteElement.style.left = "0";
    handle.spriteElement.style.top = "0";
    handle.spriteElement.style.transform = `scaleX(${state.lookRight ? -1 : 1})`;
    if (!sprite) {
      handle.element.style.transform = `translate3d(${state.x - state.anchorX}px, ${state.y - state.anchorY}px, 0)`;
      return;
    }
    let width = 128;
    let height = 128;
    handle.spriteElement.style.backgroundImage = `url("${sprite.url.replaceAll('"', '\\"')}")`;
    if (sprite.rectangle) {
      width = sprite.rectangle.width;
      height = sprite.rectangle.height;
      handle.spriteElement.style.backgroundPosition = `${-sprite.rectangle.x}px ${-sprite.rectangle.y}px`;
      handle.spriteElement.style.backgroundSize = "auto";
    } else {
      handle.spriteElement.style.backgroundPosition = "0 0";
      handle.spriteElement.style.backgroundSize = "contain";
      const definition = Object.values(spec.sprites).find((candidate) => typeof candidate === "object" && "url" in candidate && candidate.url === sprite.url);
      if (typeof definition === "object" && "width" in definition && definition.width !== undefined) width = definition.width;
      if (typeof definition === "object" && "height" in definition && definition.height !== undefined) height = definition.height;
    }
    handle.spriteElement.style.width = `${width}px`;
    handle.spriteElement.style.height = `${height}px`;
    handle.element.style.width = `${width}px`;
    handle.element.style.height = `${height}px`;
    const anchorX = state.lookRight ? width - state.anchorX : state.anchorX;
    handle.element.style.transform = `translate3d(${state.x - anchorX}px, ${state.y - state.anchorY}px, 0)`;
  }

  /** Removes one mascot node and releases its temporary image URL. */
  public removeMascot(handle: MascotDomHandle): void {
    if (!this.handles.delete(handle)) return;
    handle.element.remove();
    handle.spriteLease.release();
  }

  /** Returns whether an element belongs to one of this manager's mascots. */
  public owns(element: HTMLElement): boolean {
    for (const handle of this.handles) if (handle.element === element || handle.element.contains(element)) return true;
    return false;
  }

  /** Removes every mascot element and releases its temporary image URL. */
  public destroy(): void {
    for (const handle of [...this.handles]) this.removeMascot(handle);
    for (const restore of this.restoreContainerStyles.splice(0).reverse()) restore();
  }

  private applyContainerStyle(property: "position" | "overflow" | "overflowX", value: string): void {
    const previous = this.container.style[property];
    this.container.style[property] = value;
    this.restoreContainerStyles.push(() => {
      if (this.container.style[property] === value) this.container.style[property] = previous;
    });
  }
}
