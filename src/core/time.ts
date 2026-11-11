// Human-friendly time formatting.

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// "17:30", or "3 Nov 17:30" when not today.
export function formatLocalTime(iso?: string): string {
  if (!iso) return "never";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown";
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;

  if (date.toDateString() === new Date().toDateString()) {
    return time;
  }

  const day = date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return `${day} ${time}`;
}

function formatSpan(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function msUntil(iso: string): number {
  return new Date(iso).getTime() - Date.now();
}

// "3h 12m left"
export function formatRemaining(iso?: string): string {
  if (!iso) return "no end date";
  const ms = msUntil(iso);
  return ms <= 0 ? "expired" : `${formatSpan(ms)} left`;
}

// "3h 12m" (status bar)
export function formatShortRemaining(iso?: string): string {
  if (!iso) return "∞";
  const ms = msUntil(iso);
  return ms <= 0 ? "expired" : formatSpan(ms);
}

// "2h ago"
export function formatAgo(iso?: string): string {
  if (!iso) return "never used";
  const ms = Date.now() - new Date(iso).getTime();
  return ms < 60000 ? "just now" : `${formatSpan(ms)} ago`;
}
