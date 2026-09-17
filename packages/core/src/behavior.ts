import type { BehaviorDefinition, CharacterSpec, MascotEnvironment } from "./types";

type TokenKind = "number" | "identifier" | "operator" | "punctuation" | "eof";
interface Token { kind: TokenKind; value: string }
type AstNode =
  | { kind: "literal"; value: number | boolean }
  | { kind: "identifier"; name: string }
  | { kind: "member"; object: AstNode; property: string }
  | { kind: "call"; callee: AstNode; args: AstNode[] }
  | { kind: "unary"; operator: string; argument: AstNode }
  | { kind: "binary"; operator: string; left: AstNode; right: AstNode }
  | { kind: "conditional"; test: AstNode; consequent: AstNode; alternate: AstNode };

const forbiddenProperties = new Set(["__proto__", "prototype", "constructor"]);
const functions: Record<string, (...args: number[]) => number> = {
  abs: Math.abs, acos: Math.acos, acosh: Math.acosh, asin: Math.asin, asinh: Math.asinh,
  atan: Math.atan, atan2: Math.atan2, atanh: Math.atanh, cbrt: Math.cbrt, ceil: Math.ceil,
  cos: Math.cos, cosh: Math.cosh, exp: Math.exp, expm1: Math.expm1, floor: Math.floor,
  hypot: Math.hypot, log: Math.log, log1p: Math.log1p, log2: Math.log2, log10: Math.log10,
  max: Math.max, min: Math.min, pow: Math.pow, random: (maximum = 1) => Math.random() * maximum,
  round: Math.round, sign: Math.sign, sin: Math.sin, sinh: Math.sinh, sqrt: Math.sqrt,
  tan: Math.tan, tanh: Math.tanh, trunc: Math.trunc,
};
const constants: Record<string, number> = { E: Math.E, PI: Math.PI };

function normalizeExpression(source: string): string {
  return source
    .trim()
    .replace(/^(?:#|\$)\{/, "")
    .replace(/\}$/, "")
    .replace(/Math\.(random|min|max|abs|floor|ceil|round|sqrt|pow|sin|cos|tan|asin|acos|atan|sinh|cosh|tanh|asinh|acosh|atanh|cbrt|log|log2|log10|exp|expm1|log1p|trunc|sign|hypot|atan2)/g, "$1")
    .replace(/Math\.(PI|E)\b/g, "$1")
    .replace(/Mascot\./gi, "mascot.")
    .replace(/TargetX|目的地X/gi, "targetX")
    .replace(/TargetY|目的地Y/gi, "targetY")
    .replace(/FootX|足X/gi, "footX")
    .replace(/FootY|足Y/gi, "footY")
    .replace(/MaxCount/gi, "maxCount")
    .replace(/Gap/gi, "gap")
    .replace(/\band\b/gi, "&&")
    .replace(/\bor\b/gi, "||")
    .replace(/\bnot\b/gi, "!");
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const rest = source.slice(index);
    const whitespace = /^\s+/.exec(rest);
    if (whitespace) { index += whitespace[0].length; continue; }
    const number = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(rest);
    if (number) { tokens.push({ kind: "number", value: number[0] }); index += number[0].length; continue; }
    const identifier = /^[A-Za-z_$\u0080-\uFFFF][\w$\u0080-\uFFFF]*/u.exec(rest);
    if (identifier) { tokens.push({ kind: "identifier", value: identifier[0] }); index += identifier[0].length; continue; }
    const operator = /^(?:===|!==|==|!=|<=|>=|&&|\|\||[+\-*/%^<>!?:.,()])/.exec(rest);
    if (!operator) throw new SyntaxError(`Unexpected token at ${index}`);
    const value = operator[0];
    tokens.push({ kind: value === "(" || value === ")" || value === "," || value === "." ? "punctuation" : "operator", value });
    index += value.length;
  }
  tokens.push({ kind: "eof", value: "" });
  return tokens;
}

class Parser {
  private index = 0;
  public constructor(private readonly tokens: Token[]) {}
  public parse(): AstNode {
    const node = this.parseConditional();
    if (this.peek().kind !== "eof") throw new SyntaxError(`Unexpected '${this.peek().value}'`);
    return node;
  }
  private peek(): Token { return this.tokens[this.index] ?? { kind: "eof", value: "" }; }
  private take(value?: string): Token {
    const token = this.peek();
    if (value !== undefined && token.value !== value) throw new SyntaxError(`Expected '${value}'`);
    this.index += 1;
    return token;
  }
  private match(...values: string[]): boolean {
    if (!values.includes(this.peek().value)) return false;
    this.index += 1;
    return true;
  }
  private parseConditional(): AstNode {
    const test = this.parseOr();
    if (!this.match("?")) return test;
    const consequent = this.parseConditional();
    this.take(":");
    return { kind: "conditional", test, consequent, alternate: this.parseConditional() };
  }
  private parseOr(): AstNode { return this.binary(() => this.parseAnd(), ["||"]); }
  private parseAnd(): AstNode { return this.binary(() => this.parseEquality(), ["&&"]); }
  private parseEquality(): AstNode { return this.binary(() => this.parseComparison(), ["==", "===", "!=", "!=="]); }
  private parseComparison(): AstNode { return this.binary(() => this.parseAdditive(), ["<", "<=", ">", ">="]); }
  private parseAdditive(): AstNode { return this.binary(() => this.parseMultiplicative(), ["+", "-"]); }
  private parseMultiplicative(): AstNode { return this.binary(() => this.parsePower(), ["*", "/", "%"]); }
  private parsePower(): AstNode { return this.binary(() => this.parseUnary(), ["^"]); }
  private binary(next: () => AstNode, operators: string[]): AstNode {
    let left = next();
    while (operators.includes(this.peek().value)) {
      const operator = this.take().value;
      left = { kind: "binary", operator, left, right: next() };
    }
    return left;
  }
  private parseUnary(): AstNode {
    if (["!", "+", "-"].includes(this.peek().value)) {
      return { kind: "unary", operator: this.take().value, argument: this.parseUnary() };
    }
    return this.parsePostfix();
  }
  private parsePostfix(): AstNode {
    let node = this.parsePrimary();
    for (;;) {
      if (this.match(".")) {
        const property = this.take();
        if (property.kind !== "identifier" || forbiddenProperties.has(property.value)) throw new SyntaxError("Unsafe member access");
        node = { kind: "member", object: node, property: property.value };
      } else if (this.match("(")) {
        const args: AstNode[] = [];
        if (!this.match(")")) {
          do { args.push(this.parseConditional()); } while (this.match(","));
          this.take(")");
        }
        node = { kind: "call", callee: node, args };
      } else return node;
    }
  }
  private parsePrimary(): AstNode {
    const token = this.take();
    if (token.kind === "number") return { kind: "literal", value: Number(token.value) };
    if (token.kind === "identifier") {
      if (token.value === "true" || token.value === "false") return { kind: "literal", value: token.value === "true" };
      return { kind: "identifier", name: token.value };
    }
    if (token.value === "(") {
      const node = this.parseConditional();
      this.take(")");
      return node;
    }
    throw new SyntaxError(`Unexpected '${token.value}'`);
  }
}

function resolveMember(node: Extract<AstNode, { kind: "member" }>, scope: Record<string, unknown>): { owner: unknown; value: unknown } {
  const owner = evaluateNode(node.object, scope);
  if ((typeof owner !== "object" && typeof owner !== "function") || owner === null) return { owner, value: undefined };
  if (forbiddenProperties.has(node.property)) return { owner, value: undefined };
  return { owner, value: (owner as Record<string, unknown>)[node.property] };
}

function evaluateNode(node: AstNode, scope: Record<string, unknown>): unknown {
  switch (node.kind) {
    case "literal": return node.value;
    case "identifier": return Object.hasOwn(scope, node.name) ? scope[node.name] : functions[node.name] ?? constants[node.name];
    case "member": return resolveMember(node, scope).value;
    case "call": {
      const member = node.callee.kind === "member" ? resolveMember(node.callee, scope) : undefined;
      const callable = member?.value ?? evaluateNode(node.callee, scope);
      if (typeof callable !== "function") throw new TypeError("Expression value is not callable");
      return callable.apply(member?.owner, node.args.map((argument) => evaluateNode(argument, scope)));
    }
    case "unary": {
      const value = evaluateNode(node.argument, scope);
      if (node.operator === "!") return !value;
      if (node.operator === "+") return Number(value);
      return -Number(value);
    }
    case "conditional": return evaluateNode(node.test, scope) ? evaluateNode(node.consequent, scope) : evaluateNode(node.alternate, scope);
    case "binary": {
      if (node.operator === "&&") return Boolean(evaluateNode(node.left, scope)) && Boolean(evaluateNode(node.right, scope));
      if (node.operator === "||") return Boolean(evaluateNode(node.left, scope)) || Boolean(evaluateNode(node.right, scope));
      const left = evaluateNode(node.left, scope);
      const right = evaluateNode(node.right, scope);
      switch (node.operator) {
        case "+": return Number(left) + Number(right);
        case "-": return Number(left) - Number(right);
        case "*": return Number(left) * Number(right);
        case "/": return Number(left) / Number(right);
        case "%": return Number(left) % Number(right);
        case "^": return Math.pow(Number(left), Number(right));
        case "==": case "===": return left === right;
        case "!=": case "!==": return left !== right;
        case "<": return Number(left) < Number(right);
        case "<=": return Number(left) <= Number(right);
        case ">": return Number(left) > Number(right);
        case ">=": return Number(left) >= Number(right);
        default: return false;
      }
    }
  }
}

const expressionCache = new Map<string, AstNode>();

/** Safely evaluates a legacy Shimeji expression without using `eval` or `Function`. */
export function evaluateExpression(expression: string | number | boolean | undefined, environment: MascotEnvironment, fallback: number): number;
/** Safely evaluates a legacy Shimeji expression without using `eval` or `Function`. */
export function evaluateExpression(expression: string | number | boolean | undefined, environment: MascotEnvironment, fallback: boolean): boolean;
/** Safely evaluates a legacy Shimeji expression without using `eval` or `Function`. */
export function evaluateExpression(expression: string | number | boolean | undefined, environment: MascotEnvironment, fallback: number | boolean): number | boolean {
  if (expression === undefined) return fallback;
  if (typeof expression !== "string") return expression;
  try {
    const normalized = normalizeExpression(expression);
    let ast = expressionCache.get(normalized);
    if (!ast) { ast = new Parser(tokenize(normalized)).parse(); expressionCache.set(normalized, ast); }
    const result = evaluateNode(ast, environment as unknown as Record<string, unknown>);
    if (typeof fallback === "boolean") return Boolean(result);
    const numericResult = Number(result);
    return Number.isNaN(numericResult) ? fallback : numericResult;
  } catch { return fallback; }
}

/** Returns true when every condition in a behavior or action is satisfied. */
export function conditionsMatch(conditions: readonly string[], environment: MascotEnvironment): boolean {
  return conditions.every((condition) => evaluateExpression(condition, environment, false));
}

/** Chooses one item with probability proportional to its non-negative weight. */
export function selectWeighted<T>(items: readonly T[], weight: (item: T) => number, random: () => number = Math.random): T | undefined {
  const weighted = items.map((item) => ({ item, weight: Math.max(0, weight(item)) }));
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return undefined;
  let cursor = random() * total;
  for (const entry of weighted) { cursor -= entry.weight; if (cursor < 0) return entry.item; }
  return weighted.at(-1)?.item;
}

/** Selects applicable behaviors and resolves legacy behavior references. */
export class BehaviorController {
  private previous: BehaviorDefinition | undefined;

  /** Creates a behavior selector for a normalized character specification. */
  public constructor(private readonly spec: CharacterSpec, private readonly random: () => number = Math.random) {}

  /** Selects an initial behavior, honoring an explicit requested name when possible. */
  public selectInitial(environment: MascotEnvironment, requestedName?: string): BehaviorDefinition | undefined {
    if (requestedName) {
      const requested = this.spec.behaviors.find((behavior) => behavior.name === requestedName);
      if (requested && conditionsMatch(requested.conditions, environment)) return (this.previous = this.resolve(requested));
    }
    const fall = this.findFallBehavior();
    if (fall && !this.isOnAnyBoundary(environment)) return (this.previous = fall);
    return (this.previous = this.choose(this.spec.behaviors, environment));
  }

  /** Selects the weighted transition following the current behavior. */
  public selectNext(environment: MascotEnvironment): BehaviorDefinition | undefined {
    const pool = this.previous?.nextBehaviors.length ? this.previous.nextBehaviors : this.spec.behaviors;
    return (this.previous = this.choose(pool, environment) ?? this.findFallBehavior());
  }

  /** Replaces selection history so an external interaction can force a behavior. */
  public force(name: string): BehaviorDefinition | undefined {
    const behavior = this.spec.behaviors.find((candidate) => candidate.name === name);
    return (this.previous = behavior ? this.resolve(behavior) : undefined);
  }

  private choose(pool: readonly BehaviorDefinition[], environment: MascotEnvironment): BehaviorDefinition | undefined {
    const applicable = pool.filter((behavior) => conditionsMatch(behavior.conditions, environment));
    const chosen = selectWeighted(applicable, (behavior) => behavior.frequency, this.random);
    return chosen ? this.resolve(chosen) : undefined;
  }

  private resolve(behavior: BehaviorDefinition): BehaviorDefinition {
    if (behavior.type !== "Reference") return behavior;
    const target = this.spec.behaviors.find((candidate) => candidate.type === "Behavior" && candidate.name === behavior.name);
    return target ? { ...target, ...behavior, type: "Behavior", nextBehaviors: target.nextBehaviors } : { ...behavior, type: "Behavior" };
  }

  private findFallBehavior(): BehaviorDefinition | undefined {
    return this.spec.behaviors.find((behavior) => behavior.name === "Fall" || behavior.name === "落下する");
  }

  private isOnAnyBoundary(environment: MascotEnvironment): boolean {
    const anchor = environment.mascot.anchor;
    const area = environment.mascot.environment.workArea;
    const activeIE = environment.mascot.environment.activeIE;
    return area.topBorder.isOn(anchor)
      || area.leftBorder.isOn(anchor)
      || area.rightBorder.isOn(anchor)
      || area.bottomBorder.isOn(anchor)
      || (activeIE.visible && (
        activeIE.topBorder.isOn(anchor)
        || activeIE.leftBorder.isOn(anchor)
        || activeIE.rightBorder.isOn(anchor)
        || activeIE.bottomBorder.isOn(anchor)
      ));
  }
}
