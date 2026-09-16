/** A two-dimensional point in work-area coordinates. */
export interface Point {
  /** Horizontal coordinate in CSS pixels. */
  x: number;
  /** Vertical coordinate in CSS pixels. */
  y: number;
}

/** A rectangular region in a spritesheet or work area. */
export interface Rectangle extends Point {
  /** Rectangle width in CSS pixels. */
  width: number;
  /** Rectangle height in CSS pixels. */
  height: number;
}

/** A sprite cropped from the character's atlas. */
export interface SpriteRectangle extends Rectangle {
  /** Optional URL overriding the character-level spritesheet for this sprite. */
  url?: string;
}

/** A standalone sprite image rather than an atlas crop. */
export interface IndividualSprite {
  /** Image URL or data URI. */
  url: string;
  /** Optional known image width. */
  width?: number;
  /** Optional known image height. */
  height?: number;
}

/** Sprite definitions keyed by the legacy image path, such as `/shime1.png`. */
export type SpriteMap = Record<string, SpriteRectangle | IndividualSprite | string>;

/** One legacy animation pose. Durations use the traditional 40 ms unit. */
export interface Pose {
  /** Sprite key from the character's sprite map, or an image URL. */
  sprite: string;
  /** Point within the sprite that occupies the mascot's world position. */
  anchor: Point;
  /** Per-legacy-frame movement encoded by the character pack. */
  velocity: Point;
  /** Number of 40 ms units for which the pose remains active. */
  duration: number;
}

/** A conditional collection of poses used by an action. */
export interface AnimationDefinition {
  /** Optional Shimeji expression controlling whether this animation applies. */
  condition?: string;
  /** Ordered pose frames. */
  poses: Pose[];
}

/** Kind of action understood by the action executor. */
export type ActionType = "Sequence" | "Select" | "Reference" | "Stay" | "Animate" | "Move" | "Embedded";

/** Boundary on which an action is allowed to begin. */
export type BorderType = "Floor" | "Wall" | "Ceiling";

/** A normalized action from a compiled or XML character definition. */
export interface ActionDefinition {
  /** Action implementation kind. */
  type: ActionType;
  /** Stable action name used by behaviors and references. */
  name?: string;
  /** Embedded action class name such as `Fall`, `Dragged`, or `Look`. */
  embedType?: string;
  /** Optional expression that must evaluate truthfully. */
  condition?: string;
  /** Optional boundary prerequisite. */
  borderType?: BorderType;
  /** Nested actions for sequence and selection nodes. */
  actions?: ActionDefinition[];
  /** Conditional pose alternatives for leaf actions. */
  animations?: AnimationDefinition[];
  /** Whether a sequence should repeat. */
  loop?: boolean;
  /** Duration expression measured in legacy frames. */
  duration?: string | number;
  /** Legacy expression gap made available while evaluating other properties. */
  gap?: string | number;
  /** Horizontal target expression. */
  targetX?: string | number;
  /** Vertical target expression. */
  targetY?: string | number;
  /** Movement speed expression. */
  velocity?: string | number;
  /** Horizontal offset expression. */
  x?: string | number;
  /** Vertical offset expression. */
  y?: string | number;
  /** Initial horizontal velocity expression. */
  initialVx?: string | number;
  /** Initial vertical velocity expression. */
  initialVy?: string | number;
  /** Horizontal air-resistance expression. */
  resistanceX?: string | number;
  /** Vertical air-resistance expression. */
  resistanceY?: string | number;
  /** Gravity expression. */
  gravity?: string | number;
  /** Child spawn horizontal offset expression. */
  bornX?: string | number;
  /** Child spawn vertical offset expression. */
  bornY?: string | number;
  /** Behavior assigned to a spawned child. */
  bornBehavior?: string;
  /** Carried-element horizontal offset expression. */
  ieOffsetX?: string | number;
  /** Carried-element vertical offset expression. */
  ieOffsetY?: string | number;
  /** Facing expression used by Look actions. */
  lookRight?: string | boolean;
}

/** Kind of behavior node stored in a character specification. */
export type BehaviorType = "Behavior" | "Reference";

/** One weighted behavior and its possible transitions. */
export interface BehaviorDefinition {
  /** Whether this is a complete behavior or a reference to one. */
  type: BehaviorType;
  /** Name of the behavior and its same-named action. */
  name: string;
  /** Relative random-selection weight. */
  frequency: number;
  /** Conditions that must all be true. */
  conditions: string[];
  /** Candidates considered after this behavior completes. */
  nextBehaviors: BehaviorDefinition[];
  /** Menu grouping value retained from legacy packs. */
  groupIndex: number;
  /** Whether user interfaces should hide the behavior. */
  hidden: boolean;
}

/** Free-form character attribution and directory metadata. */
export interface CharacterMetadata {
  /** Character display name. */
  shimejiName?: string;
  /** Character group identifier. */
  group?: string;
  /** Character group display name. */
  groupName?: string;
  /** Original artist name. */
  artistName?: string | null;
  /** Upstream source URL. */
  sourceUrl?: string;
  /** Any additional pack-specific metadata. */
  [key: string]: unknown;
}

/** Fully parsed character data consumed by the engine. */
export interface CharacterSpec {
  /** Stable identifier used when spawning the character. */
  id: string;
  /** Optional human-readable name. */
  name?: string;
  /** Character attribution metadata. */
  metadata?: CharacterMetadata;
  /** Spritesheet URL, data URI, or Blob owned by spawned mascots. */
  spritesheet: string | Blob;
  /** Atlas rectangles or individual sprite URLs. */
  sprites: SpriteMap;
  /** Parsed action tree definitions. */
  actions: ActionDefinition[];
  /** Parsed behavior state-machine definitions. */
  behaviors: BehaviorDefinition[];
}

/** Legacy bundle whose XML and JSON fields have not necessarily been parsed. */
export interface LegacyCharacterPack {
  /** Stable character identifier; inferred from metadata when omitted. */
  id?: string;
  /** Optional human-readable name. */
  name?: string;
  /** Optional wrapper object used by some pack exporters. */
  configuration?: unknown;
  /** Parsed actions or raw `actions.xml` text. */
  actions: ActionDefinition[] | string;
  /** Parsed behaviors or raw `behaviors.xml` text. */
  behaviors: BehaviorDefinition[] | string;
  /** Parsed sprite map or raw `sprites.json` text. */
  sprites: SpriteMap | string;
  /** Spritesheet URL, data URI, or Blob. */
  spritesheet: string | Blob;
  /** Optional character metadata. */
  metadata?: CharacterMetadata;
}

/** Supported input accepted by the character loader. */
export type CharacterSource = CharacterSpec | LegacyCharacterPack | string | URL;

/** Initial placement and state for a newly spawned mascot. */
export interface SpawnOptions extends Partial<Point> {
  /** Initial horizontal velocity. */
  vx?: number;
  /** Initial vertical velocity. */
  vy?: number;
  /** Initial facing direction. */
  lookRight?: boolean;
  /** Behavior to run first. */
  behaviorName?: string;
}

/** Public immutable snapshot of a mascot. */
export interface MascotState extends Point {
  /** Unique mascot instance identifier. */
  id: string;
  /** Registered character identifier. */
  characterId: string;
  /** Current horizontal velocity. */
  vx: number;
  /** Current vertical velocity. */
  vy: number;
  /** Current sprite key. */
  sprite: string;
  /** Current horizontal sprite anchor. */
  anchorX: number;
  /** Current vertical sprite anchor. */
  anchorY: number;
  /** Whether the sprite faces right. */
  lookRight: boolean;
  /** Name of the current behavior. */
  behaviorName: string;
  /** Whether the mascot is currently being dragged. */
  dragging: boolean;
}

/** Runtime options for a Shimeji engine. */
export interface ShimejiEngineOptions {
  /** Legacy frame duration in milliseconds. Defaults to 40. */
  frameDuration?: number;
  /** Default gravity in legacy pixels per frame squared. Defaults to 2. */
  gravity?: number;
  /** Maximum elapsed time applied to one animation update. Defaults to 100 ms. */
  maxDeltaTime?: number;
  /** CSS class added to the generated work area. */
  workAreaClassName?: string;
  /** CSS class added to each generated mascot element. */
  mascotClassName?: string;
  /** Optional deterministic random-number source. */
  random?: () => number;
}

/** Events emitted by {@link ShimejiEngine}. */
export interface ShimejiEngineEventMap {
  /** Emitted after a mascot is created. */
  spawn: MascotState;
  /** Emitted immediately before a mascot is discarded. */
  remove: MascotState;
  /** Emitted when the state collection changes during a frame. */
  statechange: MascotState[];
  /** Emitted when a mascot is clicked without being dragged. */
  click: MascotState;
  /** Emitted when a recoverable pack or runtime error occurs. */
  error: Error;
}

/** Typed callback for one engine event. */
export type ShimejiEventListener<K extends keyof ShimejiEngineEventMap> = (payload: ShimejiEngineEventMap[K]) => void;

/** Read-only environment supplied to expression and action evaluation. */
export interface MascotEnvironment {
  /** Current mascot snapshot. */
  mascot: {
    /** Current number of live mascots. */
    totalCount: number;
    /** Current anchor position. */
    anchor: Point;
    /** Current facing direction. */
    lookRight: boolean;
    /** Browser and work-area values exposed to legacy expressions. */
    environment: {
      /** Latest pointer position and velocity. */
      cursor: Point & { dx: number; dy: number };
      /** Current viewport dimensions. */
      screen: { width: number; height: number };
      /** Current work-area bounds and edge predicates. */
      workArea: EnvironmentRectangle;
      /** Alias for the work-area bottom edge. */
      floor: EnvironmentEdge;
      /** Alias for the work-area top edge. */
      ceiling: EnvironmentEdge;
      /** Inactive compatibility rectangle for page-element actions. */
      activeIE: EnvironmentRectangle & { visible: boolean };
    };
  };
  /** Legacy expression gap variable. */
  gap: number;
  /** Configured upper mascot count. */
  maxCount: number;
  /** Current action target x-coordinate. */
  targetX?: number;
  /** Current action target y-coordinate. */
  targetY?: number;
  /** Dragging animation foot x-coordinate. */
  footX?: number;
  /** Dragging animation foot y-coordinate. */
  footY?: number;
}

/** Edge predicate exposed to legacy expressions. */
export interface EnvironmentEdge {
  /** Returns whether a point is on this edge. */
  isOn(point: Point): boolean;
}

/** Rectangle and edge predicates exposed to legacy expressions. */
export interface EnvironmentRectangle extends Rectangle {
  /** Left edge coordinate. */
  left: number;
  /** Right edge coordinate. */
  right: number;
  /** Top edge coordinate. */
  top: number;
  /** Bottom edge coordinate. */
  bottom: number;
  /** Top edge predicate. */
  topBorder: EnvironmentEdge;
  /** Left edge predicate. */
  leftBorder: EnvironmentEdge;
  /** Right edge predicate. */
  rightBorder: EnvironmentEdge;
  /** Bottom edge predicate. */
  bottomBorder: EnvironmentEdge;
}
