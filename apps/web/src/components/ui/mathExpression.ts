type Token = number | '+' | '-' | '*' | '/' | '(' | ')';

function tokenize(expression: string): Token[] | null {
  const normalized = expression.replace(/[x×]/gi, '*');
  const tokens: Token[] = [];
  let index = 0;

  while (index < normalized.length) {
    const character = normalized[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }

    const numberMatch = normalized.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
    if (numberMatch) {
      tokens.push(Number(numberMatch[0]));
      index += numberMatch[0].length;
      continue;
    }

    if ('+-*/()'.includes(character)) {
      tokens.push(character as Exclude<Token, number>);
      index += 1;
      continue;
    }

    return null;
  }

  return tokens.length ? tokens : null;
}

/**
 * Evaluates the small arithmetic language accepted by numeric form fields.
 * It intentionally supports arithmetic only—no identifiers, properties, or
 * executable JavaScript.
 */
export function evaluateMathExpression(expression: string): number | null {
  const trimmed = expression.trim();
  if (!trimmed || !/[+\-*/x×]/i.test(trimmed)) return null;

  const tokens = tokenize(trimmed);
  if (!tokens) return null;

  let position = 0;
  const peek = () => tokens[position];
  const take = () => tokens[position++];

  const parseExpression = (): number | null => {
    let value = parseTerm();
    if (value == null) return null;
    while (peek() === '+' || peek() === '-') {
      const operator = take();
      const right = parseTerm();
      if (right == null) return null;
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  };

  const parseTerm = (): number | null => {
    let value = parseUnary();
    if (value == null) return null;
    while (peek() === '*' || peek() === '/') {
      const operator = take();
      const right = parseUnary();
      if (right == null || (operator === '/' && right === 0)) return null;
      value = operator === '*' ? value * right : value / right;
    }
    return value;
  };

  const parseUnary = (): number | null => {
    if (peek() === '+') {
      take();
      return parseUnary();
    }
    if (peek() === '-') {
      take();
      const value = parseUnary();
      return value == null ? null : -value;
    }
    return parsePrimary();
  };

  const parsePrimary = (): number | null => {
    const token = peek();
    if (typeof token === 'number') {
      take();
      return token;
    }
    if (token !== '(') return null;
    take();
    const value = parseExpression();
    if (peek() !== ')') return null;
    take();
    return value;
  };

  const result = parseExpression();
  if (result == null || position !== tokens.length || !Number.isFinite(result)) return null;
  return Math.round((result + Number.EPSILON) * 1e10) / 1e10;
}

export function resolveMathInput(value: string): number | null {
  const expressionResult = evaluateMathExpression(value);
  if (expressionResult != null) return expressionResult;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : null;
}
