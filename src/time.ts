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

// Monday of the week an instant falls in, in local time, as YYYY-MM-DD.
export function weekOf(iso: string, offsetHours = 0): string {
  const t = Date.parse(iso) + offsetHours * 3_600_000, d = new Date(Math.floor(t / DAY) * DAY);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
