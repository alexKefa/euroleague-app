// A small, safe arithmetic expression parser/evaluator for the builder's
// custom columns — deliberately not eval()/Function(): this only ever
// needs "+ - * / ( )" over named stat fields, and a real parser means a
// typo produces a specific, quotable error message instead of a silent
// wrong answer or a thrown SyntaxError with no context. Grammar:
//   expr := term (('+' | '-') term)*
//   term := unary (('*' | '/') unary)*
//   unary := '-' unary | '+' unary | primary
//   primary := number | identifier | '(' expr ')'

export type FormulaNode =
  | { kind: "num"; value: number }
  | { kind: "var"; name: string }
  | { kind: "neg"; value: FormulaNode }
  | { kind: "bin"; op: "+" | "-" | "*" | "/"; left: FormulaNode; right: FormulaNode };

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
      if (Number.isNaN(value)) throw new Error(`"${raw}" isn't a valid number`);
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
    throw new Error(`Unexpected character "${ch}"`);
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
  if (!t) throw new Error("Formula ends too early");
  if (t.type === "num") return { kind: "num", value: t.value };
  if (t.type === "id") return { kind: "var", name: t.name };
  if (isPunct(t, "(")) {
    const node = parseExpr(s);
    if (!isPunct(s.next(), ")")) throw new Error("Missing closing parenthesis");
    return node;
  }
  throw new Error(`Unexpected "${t.type === "punct" ? t.value : ""}"`);
}

export function parseFormula(source: string): FormulaNode {
  const trimmed = source.trim();
  if (!trimmed) throw new Error("Formula can't be empty");
  const stream = new TokenStream(tokenize(trimmed));
  const node = parseExpr(stream);
  if (!stream.atEnd()) throw new Error("Unexpected text after the formula");
  return node;
}

function collectVarNames(node: FormulaNode, out: Set<string>): void {
  if (node.kind === "var") out.add(node.name);
  else if (node.kind === "neg") collectVarNames(node.value, out);
  else if (node.kind === "bin") {
    collectVarNames(node.left, out);
    collectVarNames(node.right, out);
  }
}

// Parses and checks every referenced field is one of knownFields, in one
// call — the shape editor UI actually needs (a specific error string, or a
// ready-to-evaluate node).
export function compileFormula(source: string, knownFields: ReadonlySet<string>): { node: FormulaNode } | { error: string } {
  let node: FormulaNode;
  try {
    node = parseFormula(source);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Invalid formula" };
  }
  const names = new Set<string>();
  collectVarNames(node, names);
  for (const name of names) {
    if (!knownFields.has(name)) return { error: `Unknown field "${name}"` };
  }
  return { node };
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
