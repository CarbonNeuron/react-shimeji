import type { Rectangle } from "./types";

/** A platform rectangle paired with the DOM element that produced it. */
export interface PlatformRectangle extends Rectangle {
  element: HTMLElement;
}

/** Resolves a platform option into connected DOM elements contained by the supplied root. */
export function resolvePlatformElements(
  source: string | readonly HTMLElement[],
  root: Document | HTMLElement,
  excludedRoot?: HTMLElement,
): HTMLElement[] {
  let elements: readonly Element[];
  if (typeof source === "string") {
    try {
      elements = [...root.querySelectorAll(source)];
    } catch {
      return [];
    }
  } else {
    elements = source;
  }
  const document = root.nodeType === 9 ? root as Document : root.ownerDocument;
  if (!document) return [];
  const HTMLElementConstructor = document.defaultView?.HTMLElement;
  if (!HTMLElementConstructor) return [];
  return [...new Set(elements)].filter((element): element is HTMLElement =>
    element instanceof HTMLElementConstructor
      && element.isConnected
      && root.contains(element)
      && (!excludedRoot || !excludedRoot.contains(element)),
  );
}

/** Reads platform bounds once and converts viewport coordinates to the supplied origin. */
export function readPlatformRectangles(
  elements: readonly HTMLElement[],
  workAreaRectangle: Pick<DOMRect, "left" | "top">,
): PlatformRectangle[] {
  const rectangles: PlatformRectangle[] = [];
  for (const element of elements) {
    const rectangle = element.getBoundingClientRect();
    if (rectangle.width <= 0 || rectangle.height <= 0) continue;
    rectangles.push({
      element,
      x: rectangle.left - workAreaRectangle.left,
      y: rectangle.top - workAreaRectangle.top,
      width: rectangle.width,
      height: rectangle.height,
    });
  }
  return rectangles;
}
