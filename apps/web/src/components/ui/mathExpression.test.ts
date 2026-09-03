import { describe, expect, it } from 'vitest';
import { evaluateMathExpression, resolveMathInput } from './mathExpression';

describe('numeric field math expressions', () => {
  it.each([
    ['22.5 * 4', 90],
    ['22.5 x 4', 90],
    ['22.5 × 4', 90],
    ['(10 + 5) / 3', 5],
    ['-4 + 2 * 3', 2],
    ['1 / 4', 0.25],
  ])('evaluates %s', (expression, expected) => {
    expect(evaluateMathExpression(expression)).toBe(expected);
  });

  it.each([
    '',
    'lamp * 4',
    '1 / 0',
    'Math.max(1, 2)',
    '2 ** 3',
    '2 +',
  ])('rejects invalid arithmetic input %s', expression => {
    expect(evaluateMathExpression(expression)).toBeNull();
  });

  it('continues to accept ordinary numeric values', () => {
    expect(resolveMathInput('22.5')).toBe(22.5);
    expect(resolveMathInput('22.5 * 4')).toBe(90);
  });
});
