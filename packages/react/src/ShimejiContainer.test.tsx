// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CharacterSpec } from "@react-shimeji/core";
import { ShimejiContainer } from "./ShimejiContainer";

const character: CharacterSpec = {
  id: "react-test",
  spritesheet: "/sheet.png",
  sprites: { idle: { x: 0, y: 0, width: 32, height: 32 } },
  actions: [{ type: "Stay", name: "Idle", duration: 100, animations: [{ poses: [{ sprite: "idle", anchor: { x: 16, y: 32 }, velocity: { x: 0, y: 0 }, duration: 100 }] }] }],
  behaviors: [{ type: "Behavior", name: "Idle", frequency: 1, conditions: [], nextBehaviors: [], groupIndex: 0, hidden: false }],
};

describe("ShimejiContainer", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 11));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("preserves mascots across rerenders and cleans up on unmount", () => {
    act(() => root.render(<ShimejiContainer characters={[character]} count={2} randomize={false} />));
    const ids = Array.from(host.querySelectorAll("[data-shimeji-id]"), (element) => element.getAttribute("data-shimeji-id"));
    expect(ids).toHaveLength(2);
    act(() => root.render(<ShimejiContainer characters={[character]} count={2} randomize={false} className="updated" />));
    expect(Array.from(host.querySelectorAll("[data-shimeji-id]"), (element) => element.getAttribute("data-shimeji-id"))).toEqual(ids);
    act(() => root.unmount());
    expect(host.querySelector("[data-react-shimeji-work-area]")).toBeNull();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(11);
    root = createRoot(host);
  });
});
