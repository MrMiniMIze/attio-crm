export function todayIso(tz: string, now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

function tzOffsetMinutes(utcInstant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(utcInstant);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asIfUtc - utcInstant.getTime()) / 60_000);
}

/** 17:00 local time on `dateIso` (YYYY-MM-DD) in `tz`, as a UTC ISO string. */
export function deadlineIso(dateIso: string, tz: string): string {
  const guess = new Date(`${dateIso}T17:00:00Z`);
  const offset = tzOffsetMinutes(guess, tz);
  return new Date(guess.getTime() - offset * 60_000).toISOString();
}
