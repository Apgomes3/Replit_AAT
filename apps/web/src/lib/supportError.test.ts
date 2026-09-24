import { describe, expect, it } from 'vitest';
import { supportError } from './supportError';

describe('support error references', () => {
  it('correlates a safe server reference with the browser error', () => {
    expect(supportError({ response: { headers: { 'x-correlation-id': '12345678-1234-1234-1234-123456789abc' } } }, 'Retry')).toBe('Retry Reference: 12345678-1234-1234-1234-123456789abc');
    expect(supportError({ response: { data: { error: { correlationId: 'secret\ninjected' } } } }, 'Retry')).toBe('Retry');
  });
});