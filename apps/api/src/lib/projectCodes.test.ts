import { describe, expect, it } from 'vitest';
import { COUNTRY_CALLING_CODES, nextProjectCode, projectCodePrefix } from './projectCodes';

describe('projectCodePrefix', () => {
  it('zero-pads the calling code to three digits', () => {
    expect(projectCodePrefix('China')).toBe('086');
    expect(projectCodePrefix('United States')).toBe('001');
    expect(projectCodePrefix('Portugal')).toBe('351');
  });
  it('is case- and space-insensitive and knows common aliases', () => {
    expect(projectCodePrefix('  hong   kong ')).toBe('852');
    expect(projectCodePrefix('USA')).toBe('001');
    expect(projectCodePrefix('UAE')).toBe('971');
  });
  it('shares one prefix for countries on the same calling code', () => {
    expect(projectCodePrefix('Canada')).toBe('001');
    expect(projectCodePrefix('Jamaica')).toBe('001');
    expect(projectCodePrefix('Kazakhstan')).toBe(projectCodePrefix('Russia'));
  });
  it('returns null for unknown or empty input', () => {
    expect(projectCodePrefix('Atlantis')).toBeNull();
    expect(projectCodePrefix('')).toBeNull();
    expect(projectCodePrefix(undefined)).toBeNull();
  });
  it('has a numeric code for every country', () => {
    for (const code of Object.values(COUNTRY_CALLING_CODES)) expect(code).toMatch(/^\d{1,3}$/);
  });
});

describe('nextProjectCode', () => {
  it('starts at 001', () => expect(nextProjectCode('086', [])).toBe('086-001'));
  it('goes one past the highest number, keeping gaps', () => {
    expect(nextProjectCode('001', ['001-033', '001-002', '086-099'])).toBe('001-034');
  });
  it('ignores codes that only look similar', () => {
    expect(nextProjectCode('086', ['086-A01', '0860-500', 'X086-900', '086-004-B'])).toBe('086-001');
  });
  it('grows past three digits', () => expect(nextProjectCode('044', ['044-999'])).toBe('044-1000'));
});
