import type { Rectangle } from "./types";

/** A platform rectangle paired with the DOM element that produced it. */
export interface PlatformRectangle extends Rectangle {
  element: HTMLElement;
}

/** Resolves a platform option into DOM elements, excluding engine-owned nodes. */
export function resolvePlatformElements(
  source: string | readonly HTMLElement[],
  document: Document,
  excludedRoot?: HTMLElement,
): HTMLElement[] {
  let elements: readonly Element[];
  if (typeof source === "string") {
    try {
      elements = [...document.querySelectorAll(source)];
    } catch {
      return [];
    }
  } else {
    elements = source;
  }
  const HTMLElementConstructor = document.defaultView?.HTMLElement;
  if (!HTMLElementConstructor) return [];
  return [...new Set(elements)].filter((element): element is HTMLElement =>
    element instanceof HTMLElementConstructor && element.isConnected && (!excludedRoot || !excludedRoot.contains(element)),
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
