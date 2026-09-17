// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { readPlatformRectangles, resolvePlatformElements } from "./platform";

describe("DOM platform geometry", () => {
  it("detects selector matches and converts their bounds to work-area coordinates", () => {
    const platform = document.createElement("div");
    platform.className = "mascot-platform";
    document.body.append(platform);
    const getBoundingClientRect = vi.spyOn(platform, "getBoundingClientRect").mockReturnValue({
      left: 140,
      top: 90,
      width: 120,
      height: 30,
    } as DOMRect);

    const elements = resolvePlatformElements(".mascot-platform", document);
    const rectangles = readPlatformRectangles(elements, { left: 40, top: 20 });

    expect(rectangles).toEqual([{ element: platform, x: 100, y: 70, width: 120, height: 30 }]);
    expect(getBoundingClientRect).toHaveBeenCalledOnce();
    platform.remove();
  });

  it("deduplicates element references before reading layout", () => {
    const platform = document.createElement("div");
    document.body.append(platform);
    const getBoundingClientRect = vi.spyOn(platform, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 50, height: 20,
    } as DOMRect);

    const elements = resolvePlatformElements([platform, platform], document);
    expect(readPlatformRectangles(elements, { left: 0, top: 0 })).toHaveLength(1);
    expect(getBoundingClientRect).toHaveBeenCalledOnce();
    platform.remove();
  });
});
