import { SpriteManager, type SpriteLease } from "./sprite";
import type { CharacterSpec, MascotState, Rectangle } from "./types";

/** DOM nodes and resources owned by one mascot. */
export interface MascotDomHandle {
  /** Fixed, pointer-transparent mascot wrapper. */
  element: HTMLDivElement;
  /** Pointer-interactive child element on which sprite images are painted. */
  spriteElement: HTMLDivElement;
  /** Per-mascot spritesheet URL lease. */
  spriteLease: SpriteLease;
}

/** Creates and updates all DOM owned by an engine instance. */
export class DomManager {
  private readonly handles = new Set<MascotDomHandle>();

  /** Uses the supplied element only as a mount point for independent mascots. */
  public constructor(
    private readonly container: HTMLElement,
    private readonly sprites: SpriteManager,
  ) {}

  /** Reattaches mascot elements if application code temporarily removed them. */
  public ensureMounted(): void {
    const target = this.container.ownerDocument.body;
    for (const handle of this.handles) {
      if (handle.element.parentElement !== target) target.appendChild(handle.element);
    }
  }

  /** Returns viewport bounds because fixed mascots use viewport coordinates. */
  public getBounds(): Rectangle {
    const view = this.container.ownerDocument.defaultView ?? window;
    return { x: 0, y: 0, width: view.innerWidth, height: view.innerHeight };
  }

  /** Creates a mascot node and acquires its spritesheet resource. */
  public createMascot(spec: CharacterSpec, mascotId: string, mascotClassName?: string): MascotDomHandle {
    const spriteLease = this.sprites.acquire(spec.spritesheet);
    const element = document.createElement("div");
    element.dataset.shimejiId = mascotId;
    if (mascotClassName) element.className = mascotClassName;
    Object.assign(element.style, { position: "fixed", left: "0", top: "0", width: "0", height: "0", pointerEvents: "none", zIndex: "9999", userSelect: "none", willChange: "transform" });
    const spriteElement = document.createElement("div");
    Object.assign(spriteElement.style, { position: "absolute", left: "0", top: "0", backgroundRepeat: "no-repeat", transformOrigin: "center center", pointerEvents: "auto", touchAction: "none", userSelect: "none" });
    element.appendChild(spriteElement);
    const handle = { element, spriteElement, spriteLease };
    this.handles.add(handle);
    this.container.ownerDocument.body.appendChild(element);
    return handle;
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
  }
}
