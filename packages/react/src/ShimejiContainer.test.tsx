// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShimejiEngine, type CharacterSpec } from "@react-shimeji/core";
import { ShimejiContainer } from "./ShimejiContainer";
import { useShimejiPlatform } from "./ShimejiPlatformContext";

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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("preserves mascots across rerenders and cleans up on unmount", () => {
    act(() => root.render(<ShimejiContainer characters={[character]} count={2} randomize={false} />));
    const container = host.firstElementChild as HTMLElement;
    const ids = Array.from(container.querySelectorAll("[data-shimeji-id]"), (element) => element.getAttribute("data-shimeji-id"));
    expect(ids).toHaveLength(2);
    expect(container.style.position).toBe("relative");
    expect(container.style.overflowX).toBe("clip");
    expect(container.querySelector<HTMLElement>("[data-shimeji-id]")?.style.position).toBe("absolute");
    expect(container.querySelector<HTMLElement>("[data-shimeji-id]")?.parentElement).toBe(container);
    expect(document.body.querySelector("[data-react-shimeji-work-area]")).toBeNull();
    act(() => root.render(<ShimejiContainer characters={[character]} count={2} randomize={false} className="updated" />));
    expect(Array.from(document.body.querySelectorAll("[data-shimeji-id]"), (element) => element.getAttribute("data-shimeji-id"))).toEqual(ids);
    act(() => root.unmount());
    expect(document.body.querySelector("[data-react-shimeji-work-area]")).toBeNull();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(11);
    root = createRoot(host);
  });

  it("renders children and adds hook-registered platforms to the engine", () => {
    const setPlatforms = vi.spyOn(ShimejiEngine.prototype, "setPlatforms");
    function Platform() {
      const platformRef = useShimejiPlatform<HTMLDivElement>();
      return <div ref={platformRef} data-testid="platform">ledge</div>;
    }

    act(() => root.render(
      <ShimejiContainer characters={[character]} count={0} platforms=".legacy-platform">
        <Platform />
      </ShimejiContainer>,
    ));

    const platform = host.querySelector<HTMLElement>("[data-testid='platform']")!;
    expect(platform.textContent).toBe("ledge");
    expect(setPlatforms.mock.calls.some(([source, additional]) =>
      source === ".legacy-platform" && additional?.includes(platform),
    )).toBe(true);
  });
});
