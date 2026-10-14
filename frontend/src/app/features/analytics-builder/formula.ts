// A small, safe arithmetic expression parser/evaluator for the builder's
// custom columns — deliberately not eval()/Function(): this only ever
// needs "+ - * / ( )" over named stat fields, and a real parser means a
// typo produces a specific error instead of a silent wrong answer.
// Grammar:
//   expr := term (('+' | '-') term)*
//   term := unary (('*' | '/') unary)*
//   unary := '-' unary | '+' unary | primary
//   primary := number | identifier | '(' expr ')'
//
// Identifiers are the stat catalog's aliases (PTS, REB, FG_PCT, any case);
// the legacy camelCase keys (pointsPerGame) still resolve so views saved
// before 2026-10-14 keep evaluating. Errors are codes, translated by the UI.

import { statByAlias, statByKey, type StatKey } from "../../shared/stat-catalog";

export type FormulaNode =
  | { kind: "num"; value: number }
  | { kind: "var"; name: string }
  | { kind: "neg"; value: FormulaNode }
  | { kind: "bin"; op: "+" | "-" | "*" | "/"; left: FormulaNode; right: FormulaNode };

export type FormulaErrorCode =
  | "empty"
  | "endsEarly"
  | "missingParen"
  | "unexpectedChar"
  | "unexpectedToken"
  | "trailingText"
  | "badNumber"
  | "unknownField";

export interface FormulaError {
  code: FormulaErrorCode;
  params?: { text: string };
}

class FormulaParseError extends Error {
  constructor(readonly detail: FormulaError) {
    super(detail.code);
  }
}

function fail(code: FormulaErrorCode, text?: string): never {
  throw new FormulaParseError(text === undefined ? { code } : { code, params: { text } });
}

export type Resolver = (name: string) => StatKey | null;

export const resolveStatName: Resolver = (name) => statByAlias(name)?.key ?? statByKey(name)?.key ?? null;

export const FORMULA_PRESETS: readonly { id: "pra" | "stocks" | "per40"; labelKey: string; expression: string }[] = [
  { id: "pra", labelKey: "builder.preset.pra", expression: "PTS + REB + AST" },
  { id: "stocks", labelKey: "builder.preset.stocks", expression: "STL + BLK" },
  // {X} is replaced with the stat the user picks.
  { id: "per40", labelKey: "builder.preset.per40", expression: "{X} / MIN * 40" },
];

type Token = { type: "num"; value: number } | { type: "id"; name: string } | { type: "punct"; value: string };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < source.length && /[0-9.]/.test(source[j])) j++;
      const raw = source.slice(i, j);
      const value = Number(raw);
      if (Number.isNaN(value)) fail("badNumber", raw);
      tokens.push({ type: "num", value });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i;
      while (j < source.length && /[a-zA-Z0-9_]/.test(source[j])) j++;
      tokens.push({ type: "id", name: source.slice(i, j) });
      i = j;
      continue;
    }
    if ("+-*/()".includes(ch)) {
      tokens.push({ type: "punct", value: ch });
      i++;
      continue;
    }
    fail("unexpectedChar", ch);
  }
  return tokens;
}

class TokenStream {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}
  peek(): Token | undefined {
    return this.tokens[this.pos];
  }
  next(): Token | undefined {
    return this.tokens[this.pos++];
  }
  atEnd(): boolean {
    return this.pos >= this.tokens.length;
  }
}

function isPunct(t: Token | undefined, value: string): boolean {
  return t?.type === "punct" && t.value === value;
}

function parseExpr(s: TokenStream): FormulaNode {
  let node = parseTerm(s);
  for (;;) {
    const t = s.peek();
    if (isPunct(t, "+") || isPunct(t, "-")) {
      s.next();
      node = { kind: "bin", op: (t as { type: "punct"; value: "+" | "-" }).value, left: node, right: parseTerm(s) };
    } else {
      return node;
    }
  }
}

function parseTerm(s: TokenStream): FormulaNode {
  let node = parseUnary(s);
  for (;;) {
    const t = s.peek();
    if (isPunct(t, "*") || isPunct(t, "/")) {
      s.next();
      node = { kind: "bin", op: (t as { type: "punct"; value: "*" | "/" }).value, left: node, right: parseUnary(s) };
    } else {
      return node;
    }
  }
}

function parseUnary(s: TokenStream): FormulaNode {
  if (isPunct(s.peek(), "-")) {
    s.next();
    return { kind: "neg", value: parseUnary(s) };
  }
  if (isPunct(s.peek(), "+")) {
    s.next();
    return parseUnary(s);
  }
  return parsePrimary(s);
}

function parsePrimary(s: TokenStream): FormulaNode {
  const t = s.next();
  if (!t) return fail("endsEarly");
  if (t.type === "num") return { kind: "num", value: t.value };
  if (t.type === "id") return { kind: "var", name: t.name };
  if (isPunct(t, "(")) {
    const node = parseExpr(s);
    if (!isPunct(s.next(), ")")) fail("missingParen");
    return node;
  }
  return fail("unexpectedToken", t.value);
}

export function parseFormula(source: string): FormulaNode {
  const trimmed = source.trim();
  if (!trimmed) fail("empty");
  const stream = new TokenStream(tokenize(trimmed));
  const node = parseExpr(stream);
  if (!stream.atEnd()) fail("trailingText");
  return node;
}

// Rewrites every identifier to the stat key it names, so evaluation reads
// row stats directly; the first unknown name is the error.
function resolveVars(node: FormulaNode, resolve: Resolver): FormulaNode {
  switch (node.kind) {
    case "num":
      return node;
    case "var": {
      const key = resolve(node.name);
      return key ? { kind: "var", name: key } : fail("unknownField", node.name);
    }
    case "neg":
      return { kind: "neg", value: resolveVars(node.value, resolve) };
    case "bin":
      return { ...node, left: resolveVars(node.left, resolve), right: resolveVars(node.right, resolve) };
  }
}

export function compileFormula(source: string, resolve: Resolver = resolveStatName): { node: FormulaNode } | { error: FormulaError } {
  try {
    return { node: resolveVars(parseFormula(source), resolve) };
  } catch (err) {
    if (err instanceof FormulaParseError) return { error: err.detail };
    throw err;
  }
}

export function evaluateFormula(node: FormulaNode, context: Readonly<Record<string, number | null | undefined>>): number | null {
  switch (node.kind) {
    case "num":
      return node.value;
    case "var": {
      const v = context[node.name];
      return v == null ? null : v;
    }
    case "neg": {
      const v = evaluateFormula(node.value, context);
      return v == null ? null : -v;
    }
    case "bin": {
      const l = evaluateFormula(node.left, context);
      const r = evaluateFormula(node.right, context);
      if (l == null || r == null) return null;
      switch (node.op) {
        case "+":
          return l + r;
        case "-":
          return l - r;
        case "*":
          return l * r;
        case "/":
          return r === 0 ? null : l / r;
      }
    }
  }
}

// Stats that only scale a formula (per minute, per game, per possession)
// rather than say anything good or bad on their own.
const NEUTRAL_KEYS = new Set<string>(["minutesPerGame", "gamesPlayed", "possessionsPerGame"]);

function collectVars(node: FormulaNode, out: Set<string>): void {
  if (node.kind === "var") out.add(node.name);
  else if (node.kind === "neg") collectVars(node.value, out);
  else if (node.kind === "bin") {
    collectVars(node.left, out);
    collectVars(node.right, out);
  }
}

// A compiled formula built only from lower-is-better stats (plus neutral
// scalers), e.g. TOV / MIN * 40, is shaded with lower = better too.
export function formulaLowerIsBetter(node: FormulaNode): boolean {
  const vars = new Set<string>();
  collectVars(node, vars);
  const meaningful = [...vars].filter((k) => !NEUTRAL_KEYS.has(k));
  return meaningful.length > 0 && meaningful.every((k) => statByKey(k)?.lowerIsBetter === true);
}
