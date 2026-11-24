// IANA time zones for pickers, and the local time in a zone.

const FALLBACK_ZONES = [
  'UTC', 'Asia/Shanghai', 'Asia/Manila', 'Asia/Singapore', 'Asia/Hong_Kong', 'Asia/Tokyo', 'Asia/Dubai',
  'Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane', 'Australia/Adelaide', 'Australia/Perth',
  'Pacific/Auckland', 'Europe/London', 'Europe/Lisbon', 'Europe/Paris', 'Europe/Berlin',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
];

/** Every time zone the browser knows (falls back to a short list on older browsers). */
export function timeZoneNames(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  try { return intl.supportedValuesOf ? intl.supportedValuesOf('timeZone') : FALLBACK_ZONES; } catch { return FALLBACK_ZONES; }
}

/** "14:05" in that zone, or null when the zone is unknown. */
export function localTimeIn(timeZone: string, at: Date = new Date()): string | null {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
  } catch { return null; }
}

/** "UTC+8", "UTC−3:30" or "UTC" for that zone now, or null when unknown. */
export function utcOffsetLabel(timeZone: string, at: Date = new Date()): string | null {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' })
      .formatToParts(at).find(p => p.type === 'timeZoneName')?.value;
    if (!part) return null;
    return part === 'GMT' ? 'UTC' : part.replace('GMT', 'UTC').replace('-', '−');
  } catch { return null; }
}
