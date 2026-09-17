import { createContext, useCallback, useContext, useRef, type RefCallback } from "react";
import type { ShimejiPlatformContextValue } from "./types";

const defaultContext: ShimejiPlatformContextValue = {
  registerPlatform: () => () => undefined,
};

/** Registration channel used by descendants of a ShimejiContainer. */
export const ShimejiPlatformContext = createContext<ShimejiPlatformContextValue>(defaultContext);

/** Returns a callback ref that exposes its attached element as a Shimeji platform. */
export function useShimejiPlatform<T extends HTMLElement = HTMLElement>(): RefCallback<T> {
  const { registerPlatform } = useContext(ShimejiPlatformContext);
  const unregisterRef = useRef<(() => void) | undefined>(undefined);

  return useCallback((element: T | null) => {
    unregisterRef.current?.();
    unregisterRef.current = element ? registerPlatform(element) : undefined;
  }, [registerPlatform]);
}
