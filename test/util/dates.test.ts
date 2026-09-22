import { describe, it, expect } from 'vitest';
import { todayIso, deadlineIso } from '../../src/util/dates.ts';

describe('dates', () => {
  it('todayIso uses the requested timezone', () => {
    // 2026-09-05T03:00Z is still 2026-09-04 in Los Angeles (UTC-7)
    expect(todayIso('America/Los_Angeles', new Date('2026-09-05T03:00:00Z'))).toBe('2026-09-04');
    expect(todayIso('UTC', new Date('2026-09-05T03:00:00Z'))).toBe('2026-09-05');
  });

  it('deadlineIso is 17:00 local during daylight time (UTC-7)', () => {
    expect(deadlineIso('2026-09-05', 'America/Los_Angeles')).toBe('2026-09-06T00:00:00.000Z');
  });

  it('deadlineIso is 17:00 local during standard time (UTC-8)', () => {
    expect(deadlineIso('2026-01-15', 'America/Los_Angeles')).toBe('2026-01-16T01:00:00.000Z');
  });
});
