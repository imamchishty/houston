// Time helpers that respect the team's working week and time zone. Saturday in Dubai starts at 20:00 UTC on
// Friday, so weekend days are judged in local time: TZ_OFFSET_HOURS (4 for the UAE) and WEEKEND.
const DAY = 86_400_000;

// Hours between two instants, leaving out every weekend day entirely. A PR opened Friday 16:00 and merged
// Monday 10:00 (Sat/Sun weekend) counts 8 + 10 = 18 hours, not 66.
export function hoursExcludingWeekends(fromIso: string, toIso: string, weekend: number[], offsetHours = 0): number {
  const off = offsetHours * 3_600_000, a = Date.parse(fromIso) + off, b = Date.parse(toIso) + off;
  if (!(b > a)) return 0;
  let ms = 0;
  for (let day = Math.floor(a / DAY) * DAY; day < b; day += DAY) {
    if (weekend.includes(new Date(day).getUTCDay())) continue;
    const s = Math.max(a, day), e = Math.min(b, day + DAY);
    if (e > s) ms += e - s;
  }
  return ms / 3_600_000;
}

// Outside working hours: a weekend day, or before the start or after the end of the working day, in local time.
export function outsideWorkingHours(iso: string, weekend: number[], offsetHours: number, hours: { start: number; end: number }): boolean {
  const d = new Date(Date.parse(iso) + offsetHours * 3_600_000), h = d.getUTCHours() + d.getUTCMinutes() / 60;
  return weekend.includes(d.getUTCDay()) || h < hours.start || h >= hours.end;
}

// Working time: only the working day (hours in local time) on working days. Used for support SLAs in plain Jira.
type Hours = { start: number; end: number };
const H = 3_600_000;
export function workingMinutes(fromIso: string, toIso: string, weekend: number[], offsetHours: number, hours: Hours): number {
  const off = offsetHours * H, a = Date.parse(fromIso) + off, b = Date.parse(toIso) + off;
  if (!(b > a)) return 0;
  let ms = 0;
  for (let day = Math.floor(a / DAY) * DAY; day < b; day += DAY) {
    if (weekend.includes(new Date(day).getUTCDay())) continue;
    const s = Math.max(a, day + hours.start * H), e = Math.min(b, day + hours.end * H);
    if (e > s) ms += e - s;
  }
  return ms / 60_000;
}
// The instant a working-time duration after fromIso ends: when an SLA with that goal breaches.
export function addWorkingMinutes(fromIso: string, minutes: number, weekend: number[], offsetHours: number, hours: Hours): string {
  const off = offsetHours * H; let t = Date.parse(fromIso) + off, left = minutes * 60_000;
  for (let guard = 0; guard < 3660; guard++) {
    const day = Math.floor(t / DAY) * DAY;
    if (!weekend.includes(new Date(day).getUTCDay())) {
      const s = Math.max(t, day + hours.start * H), e = day + hours.end * H;
      if (e > s) { if (s + left <= e) return new Date(s + left - off).toISOString(); left -= e - s; }
    }
    t = day + DAY;
  }
  return new Date(t - off).toISOString();
}
// "4h" or "2d" (working days) in minutes.
export const durationMinutes = (d: string, hours: Hours): number | null => {
  const m = /^(\d+(?:\.\d+)?)([hd])$/.exec(d.trim()); if (!m) return null;
  return Number(m[1]) * (m[2] === 'h' ? 60 : (hours.end - hours.start) * 60);
};

// Monday of the week an instant falls in, in local time, as YYYY-MM-DD.
export function weekOf(iso: string, offsetHours = 0): string {
  const t = Date.parse(iso) + offsetHours * 3_600_000, d = new Date(Math.floor(t / DAY) * DAY);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
