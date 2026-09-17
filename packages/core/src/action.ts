import { evaluateExpression } from "./behavior";
import { applyGravity, clamp, isOnBorder, moveToward } from "./physics";
import type { ActionDefinition, AnimationDefinition, CharacterSpec, MascotEnvironment, MascotState, Pose, Rectangle } from "./types";

/** Callbacks through which embedded actions request engine-level operations. */
export interface ActionExecutorCallbacks {
  /** Spawns another mascot from the same character. */
  spawn(position: { x: number; y: number; behaviorName?: string }): void;
  /** Removes the mascot owning this executor. */
  remove(): void;
}

/** Settings used while interpreting actions. */
export interface ActionExecutorOptions {
  /** Duration of one legacy animation unit in milliseconds. */
  frameDuration: number;
  /** Gravity used when a Fall action does not define one. */
  gravity: number;
}

interface Runtime {
  tick(deltaMs: number, environment: MascotEnvironment, bounds: Rectangle): boolean;
}

interface EvaluatedAction {
  definition: ActionDefinition;
  duration?: number | undefined;
  targetX?: number | undefined;
  targetY?: number | undefined;
  velocity?: number | undefined;
  x?: number | undefined;
  y?: number | undefined;
  initialVx?: number | undefined;
  initialVy?: number | undefined;
  resistanceX?: number | undefined;
  resistanceY?: number | undefined;
  gravity?: number | undefined;
  bornX?: number | undefined;
  bornY?: number | undefined;
  lookRight: boolean;
}

function numeric(value: string | number | undefined, environment: MascotEnvironment): number | undefined {
  return value === undefined ? undefined : evaluateExpression(value, environment, 0);
}

function evaluateAction(definition: ActionDefinition, environment: MascotEnvironment): EvaluatedAction {
  const gap = numeric(definition.gap, environment) ?? 0;
  const scopedEnvironment = { ...environment, gap };
  const targetX = numeric(definition.targetX, scopedEnvironment);
  const initialVx = numeric(definition.initialVx, scopedEnvironment);
  let lookRight = environment.mascot.lookRight;
  if (definition.borderType === "Wall") {
    const { activeIE, workArea } = environment.mascot.environment;
    lookRight = workArea.rightBorder.isOn(environment.mascot.anchor)
      || (activeIE.visible && activeIE.leftBorder.isOn(environment.mascot.anchor));
  } else if (definition.type === "Move" || definition.embedType === "Jump" || definition.embedType === "WalkWithIE") {
    if (targetX !== undefined) lookRight = targetX > environment.mascot.anchor.x;
  } else if (definition.embedType === "Fall" || definition.embedType === "FallWithIE") {
    if (initialVx !== undefined && initialVx !== 0) lookRight = initialVx > 0;
  } else if (definition.embedType === "Look") {
    lookRight = definition.lookRight === undefined
      ? !environment.mascot.lookRight
      : typeof definition.lookRight === "boolean"
        ? definition.lookRight
        : evaluateExpression(definition.lookRight, scopedEnvironment, environment.mascot.lookRight);
  }
  const duration = numeric(definition.duration, scopedEnvironment);
  const targetY = numeric(definition.targetY, scopedEnvironment);
  const velocity = numeric(definition.velocity, scopedEnvironment);
  const x = numeric(definition.x, scopedEnvironment);
  const y = numeric(definition.y, scopedEnvironment);
  const initialVy = numeric(definition.initialVy, scopedEnvironment);
  const resistanceX = numeric(definition.resistanceX, scopedEnvironment);
  const resistanceY = numeric(definition.resistanceY, scopedEnvironment);
  const gravity = numeric(definition.gravity, scopedEnvironment);
  const bornX = numeric(definition.bornX, scopedEnvironment);
  const bornY = numeric(definition.bornY, scopedEnvironment);
  return {
    definition,
    lookRight,
    ...(duration !== undefined && { duration }),
    ...(targetX !== undefined && { targetX }),
    ...(targetY !== undefined && { targetY }),
    ...(velocity !== undefined && { velocity }),
    ...(x !== undefined && { x }),
    ...(y !== undefined && { y }),
    ...(initialVx !== undefined && { initialVx }),
    ...(initialVy !== undefined && { initialVy }),
    ...(resistanceX !== undefined && { resistanceX }),
    ...(resistanceY !== undefined && { resistanceY }),
    ...(gravity !== undefined && { gravity }),
    ...(bornX !== undefined && { bornX }),
    ...(bornY !== undefined && { bornY }),
  };
}

class SequenceRuntime implements Runtime {
  private index = 0;
  private child: Runtime | undefined;
  public constructor(private readonly definitions: readonly ActionDefinition[], private readonly factory: (definition: ActionDefinition, environment: MascotEnvironment) => Runtime, private readonly loop: boolean) {}
  public tick(deltaMs: number, environment: MascotEnvironment, bounds: Rectangle): boolean {
    for (let guard = 0; guard < 32; guard += 1) {
      const definition = this.definitions[this.index];
      if (!definition) {
        if (!this.loop || this.definitions.length === 0) return true;
        this.index = 0;
        continue;
      }
      this.child ??= this.factory(definition, environment);
      if (!this.child.tick(deltaMs, environment, bounds)) return false;
      this.child = undefined;
      this.index += 1;
      deltaMs = 0;
    }
    return false;
  }
}

class CompleteRuntime implements Runtime {
  public tick(): boolean { return true; }
}

class LeafRuntime implements Runtime {
  private elapsedMs = 0;
  private started = false;
  private spawned = false;
  private readonly animation: AnimationDefinition | undefined;
  private readonly poseDuration: number;

  public constructor(
    private readonly action: EvaluatedAction,
    private readonly state: MascotState,
    private readonly options: ActionExecutorOptions,
    private readonly callbacks: ActionExecutorCallbacks,
    environment: MascotEnvironment,
  ) {
    const animationEnvironment = { ...environment, ...(action.targetX !== undefined && { targetX: action.targetX }), ...(action.targetY !== undefined && { targetY: action.targetY }) };
    this.animation = action.definition.animations?.find((animation) => !animation.condition || evaluateExpression(animation.condition, animationEnvironment, false))
      ?? action.definition.animations?.find((animation) => !animation.condition)
      ?? action.definition.animations?.[0];
    this.poseDuration = this.animation?.poses.reduce((sum, pose) => sum + Math.max(0, pose.duration), 0) ?? 0;
  }

  public tick(deltaMs: number, environment: MascotEnvironment, bounds: Rectangle): boolean {
    const frameScale = deltaMs / this.options.frameDuration;
    if (!this.started) { this.started = true; this.state.lookRight = this.action.lookRight; this.initialize(); }
    this.elapsedMs += deltaMs;
    const pose = this.currentPose();
    if (pose) this.applyPose(pose, frameScale, bounds);

    const { definition } = this.action;
    if (definition.type === "Embedded") return this.tickEmbedded(frameScale, environment, bounds);
    if (definition.type === "Move" && (this.action.targetX !== undefined || this.action.targetY !== undefined)) {
      const reachedX = this.action.targetX === undefined || Math.abs(this.state.x - this.action.targetX) < 0.5;
      const reachedY = this.action.targetY === undefined || Math.abs(this.state.y - this.action.targetY) < 0.5;
      return reachedX && reachedY;
    }
    return this.elapsedMs >= this.durationMs();
  }

  private initialize(): void {
    const type = this.action.definition.embedType;
    if (type === "Fall" || type === "FallWithIE") {
      this.state.vx = this.action.initialVx ?? this.state.vx;
      this.state.vy = this.action.initialVy ?? this.state.vy;
    }
    if (type === "Offset") {
      this.state.x += this.action.x ?? 0;
      this.state.y += this.action.y ?? 0;
    }
    if (type === "Reboot") { this.state.vx = 0; this.state.vy = 0; }
  }

  private tickEmbedded(frameScale: number, environment: MascotEnvironment, bounds: Rectangle): boolean {
    switch (this.action.definition.embedType) {
      case "Fall": case "FallWithIE": case "Thrown":
        return applyGravity(
          this.state,
          bounds,
          frameScale,
          this.action.gravity ?? this.options.gravity,
          this.action.resistanceX,
          this.action.resistanceY,
          environment.mascot.environment.activeIE.visible ? environment.mascot.environment.activeIE : undefined,
        );
      case "Jump": {
        const target = { x: this.action.targetX ?? this.state.x, y: this.action.targetY ?? this.state.y };
        return moveToward(this.state, target, this.action.velocity ?? 20, frameScale);
      }
      case "Breed":
        if (!this.spawned && this.elapsedMs >= this.durationMs()) {
          this.spawned = true;
          const child = { x: this.state.x + (this.action.bornX ?? 0), y: this.state.y + (this.action.bornY ?? 0) };
          this.callbacks.spawn(this.action.definition.bornBehavior ? { ...child, behaviorName: this.action.definition.bornBehavior } : child);
          return true;
        }
        return false;
      case "Exit": this.callbacks.remove(); return true;
      case "Reboot":
        this.state.x = bounds.x + 128 + Math.max(0, bounds.width - 256) * Math.random();
        this.state.y = bounds.y + 128 + Math.max(0, bounds.height - 256) * Math.random();
        return true;
      case "Offset": case "Look": return true;
      case "Dragged": return false;
      default: return this.elapsedMs >= this.durationMs();
    }
  }

  private currentPose(): Pose | undefined {
    if (!this.animation?.poses.length || this.poseDuration <= 0) return undefined;
    let cursor = (this.elapsedMs / this.options.frameDuration) % this.poseDuration;
    for (const pose of this.animation.poses) { cursor -= pose.duration; if (cursor < 0) return pose; }
    return this.animation.poses.at(-1);
  }

  private applyPose(pose: Pose, frameScale: number, bounds: Rectangle): void {
    this.state.sprite = pose.sprite;
    this.state.anchorX = pose.anchor.x;
    this.state.anchorY = pose.anchor.y;
    const direction = this.state.lookRight ? -1 : 1;
    this.state.x = clamp(this.state.x + pose.velocity.x * direction * frameScale, bounds.x, bounds.x + bounds.width);
    this.state.y = clamp(this.state.y + pose.velocity.y * frameScale, bounds.y, bounds.y + bounds.height);
  }

  private durationMs(): number {
    const frames = this.action.duration ?? this.poseDuration;
    return Math.max(this.options.frameDuration, frames * this.options.frameDuration);
  }
}

/** Executes normalized action trees independently from DOM rendering. */
export class ActionExecutor {
  private runtime: Runtime | undefined;

  /** Creates an executor bound to one mascot's mutable internal state. */
  public constructor(
    private readonly spec: CharacterSpec,
    private readonly state: MascotState,
    private readonly options: ActionExecutorOptions,
    private readonly callbacks: ActionExecutorCallbacks,
  ) {}

  /** Starts the action whose name matches a selected behavior. */
  public start(actionName: string, environment: MascotEnvironment): boolean {
    const definition = this.spec.actions.find((action) => action.name === actionName);
    this.runtime = definition ? this.createRuntime(definition, environment, new Set()) : undefined;
    return this.runtime !== undefined;
  }

  /** Advances the current action and returns true when it has completed. */
  public tick(deltaMs: number, environment: MascotEnvironment, bounds: Rectangle): boolean {
    return this.runtime?.tick(deltaMs, environment, bounds) ?? true;
  }

  /** Cancels the current action tree. */
  public cancel(): void { this.runtime = undefined; }

  private createRuntime(definition: ActionDefinition, environment: MascotEnvironment, references: Set<string>): Runtime {
    if (definition.condition && !evaluateExpression(definition.condition, environment, false)) return new CompleteRuntime();
    const bounds = environment.mascot.environment.workArea;
    const activeIE = environment.mascot.environment.activeIE;
    if (!isOnBorder(this.state, bounds, definition.borderType, activeIE.visible ? activeIE : undefined)) return new CompleteRuntime();
    if (definition.type === "Reference") {
      if (!definition.name || references.has(definition.name)) return new CompleteRuntime();
      const referenced = this.spec.actions.find((action) => action.name === definition.name);
      if (!referenced) return new CompleteRuntime();
      const nextReferences = new Set(references).add(definition.name);
      return this.createRuntime({ ...referenced, ...definition, type: referenced.type }, environment, nextReferences);
    }
    if (definition.type === "Sequence") {
      return new SequenceRuntime(definition.actions ?? [], (child, nextEnvironment) => this.createRuntime(child, nextEnvironment, new Set(references)), definition.loop === true);
    }
    if (definition.type === "Select") {
      const child = definition.actions?.find((candidate) => !candidate.condition || evaluateExpression(candidate.condition, environment, false));
      return child ? this.createRuntime(child, environment, new Set(references)) : new CompleteRuntime();
    }
    return new LeafRuntime(evaluateAction(definition, environment), this.state, this.options, this.callbacks, environment);
  }
}
