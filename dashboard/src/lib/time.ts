const CLOCK = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit" });
const WEEKDAY = new Intl.DateTimeFormat("id-ID", { weekday: "long" });
const SHORT_DATE = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short" });
const LONG_DATE = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric" });

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Selisih hari kalender antara tanggal itu dan hari ini. 0 = hari ini, 1 = kemarin. */
function daysAgo(date: Date, now: Date): number {
  return Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
}

/** Jam, misalnya "14.32". */
export function clock(iso: string): string {
  return CLOCK.format(new Date(iso));
}

/** Waktu ringkas untuk daftar: jam bila hari ini, "Kemarin", nama hari, lalu tanggal. */
export function listTime(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const days = daysAgo(date, now);
  if (days <= 0) return CLOCK.format(date);
  if (days === 1) return "Kemarin";
  if (days < 7) return WEEKDAY.format(date);
  return SHORT_DATE.format(date);
}

/** Judul pemisah hari di dalam percakapan. */
export function dayLabel(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const days = daysAgo(date, now);
  if (days <= 0) return "Hari ini";
  if (days === 1) return "Kemarin";
  return LONG_DATE.format(date);
}

export function sameDay(a: string, b: string): boolean {
  return startOfDay(new Date(a)) === startOfDay(new Date(b));
}

/** Kapan sesuatu terakhir diubah, misalnya "5 menit lalu" atau "12 Nov". */
export function ago(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return "baru saja";
  if (minutes < 60) return `${minutes} menit lalu`;
  const days = daysAgo(date, now);
  if (days <= 0) return `${Math.floor(minutes / 60)} jam lalu`;
  if (days === 1) return "kemarin";
  if (days < 7) return `${days} hari lalu`;
  return SHORT_DATE.format(date);
}
