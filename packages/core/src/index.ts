/** Framework-agnostic Shimeji engine. */
export { ShimejiEngine } from "./engine";
/** Character loading and legacy XML parsing utilities. */
export { loadCharacter, normalizeCharacterSpec, parseActionsXml, parseBehaviorsXml } from "./loader";
/** Behavior selection and safe expression utilities. */
export { BehaviorController, conditionsMatch, evaluateExpression, selectWeighted } from "./behavior";
/** Low-level action-tree executor. */
export { ActionExecutor } from "./action";
/** Geometry and physics helpers. */
export { applyGravity, clamp, isOnBorder, isOnBottom, isOnLeft, isOnRight, isOnTop, moveToward } from "./physics";
/** DOM platform geometry utilities. */
export { readPlatformRectangles, resolvePlatformElements } from "./platform";
export type { PlatformRectangle } from "./platform";
/** Sprite resource manager. */
export { SpriteManager, isIndividualSprite } from "./sprite";
export type * from "./types";
export type { ActionExecutorCallbacks, ActionExecutorOptions } from "./action";
export type { MascotCallbacks } from "./mascot";
export type { MascotDomHandle } from "./dom";
export type { ResolvedSprite, SpriteLease } from "./sprite";
