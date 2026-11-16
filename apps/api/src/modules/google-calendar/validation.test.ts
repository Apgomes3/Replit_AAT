import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import { decryptToken, encryptToken, mayConnect, readGoogleConfig, toCalendarEvent, validateRange } from './validation';

const KEY = crypto.randomBytes(32);
const env = {
  GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_REDIRECT_URI: 'http://localhost:5000/cb',
  GOOGLE_TOKEN_KEY: KEY.toString('base64'),
};

describe('readGoogleConfig', () => {
  it('needs every setting and a 32-byte key', () => {
    expect(readGoogleConfig(env)).toMatchObject({ clientId: 'id', allowedEmails: [] });
    expect(readGoogleConfig({ ...env, GOOGLE_CLIENT_SECRET: '' })).toBeNull();
    expect(readGoogleConfig({ ...env, GOOGLE_TOKEN_KEY: Buffer.alloc(16).toString('base64') })).toBeNull();
  });
  it('limits who may connect when an allow-list is set', () => {
    const cfg = readGoogleConfig({ ...env, GOOGLE_CALENDAR_ALLOWED_EMAILS: 'Antonio@Advanced-Aquariums.com, x@y.z' })!;
    expect(mayConnect(cfg, 'antonio@advanced-aquariums.com')).toBe(true);
    expect(mayConnect(cfg, 'someone@advanced-aquariums.com')).toBe(false);
    expect(mayConnect(readGoogleConfig(env)!, 'anyone@x.com')).toBe(true);
  });
});

describe('token encryption', () => {
  it('round-trips and does not contain the plain token', () => {
    const sealed = encryptToken('1//refresh-token', KEY);
    expect(sealed).not.toContain('refresh');
    expect(decryptToken(sealed, KEY)).toBe('1//refresh-token');
    expect(encryptToken('same', KEY)).not.toBe(encryptToken('same', KEY));
  });
  it('rejects a wrong key or tampered ciphertext', () => {
    const sealed = encryptToken('secret', KEY);
    expect(() => decryptToken(sealed, crypto.randomBytes(32))).toThrow();
    const [iv, tag, data] = sealed.split('.');
    const flipped = Buffer.from(data, 'base64'); flipped[0] ^= 1;
    expect(() => decryptToken([iv, tag, flipped.toString('base64')].join('.'), KEY)).toThrow();
  });
});

describe('validateRange', () => {
  it('accepts a forward window of up to 92 days', () => {
    expect(validateRange('2026-11-16', '2026-12-14')).toEqual({ from: '2026-11-16', to: '2026-12-14' });
    expect(validateRange('2026-11-16', '2026-11-16')).toHaveProperty('error');
    expect(validateRange('2026-01-01', '2026-06-01')).toHaveProperty('error');
    expect(validateRange('16/11/2026', '2026-12-01')).toHaveProperty('error');
    expect(validateRange(undefined, '2026-12-01')).toHaveProperty('error');
  });
});

describe('toCalendarEvent', () => {
  it('maps timed and all-day events and drops cancelled ones', () => {
    expect(toCalendarEvent({ id: 'a', summary: 'Design review', start: { dateTime: '2026-11-17T09:00:00+08:00' }, end: { dateTime: '2026-11-17T10:00:00+08:00' }, htmlLink: 'https://g/a' }))
      .toEqual({ id: 'a', title: 'Design review', start: '2026-11-17T09:00:00+08:00', end: '2026-11-17T10:00:00+08:00', all_day: false, location: null, link: 'https://g/a', busy: true });
    expect(toCalendarEvent({ id: 'b', start: { date: '2026-11-18' }, end: { date: '2026-11-19' }, transparency: 'transparent' }))
      .toMatchObject({ title: '(No title)', all_day: true, busy: false });
    expect(toCalendarEvent({ id: 'c', status: 'cancelled', start: { date: '2026-11-18' }, end: { date: '2026-11-19' } })).toBeNull();
  });
});
