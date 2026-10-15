export function formatPriority(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 0.01 || abs >= 1_000_000)) return value.toExponential(2);
  const rounded = Math.round(value * 100) / 100;
  return String(rounded);
}

export function formatDifficulty(bits: number): string {
  return (bits >>> 0).toString(16).padStart(8, "0");
}

export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) return "—";
  if (size < 1024) return `${Math.round(size)} B`;
  if (size < 1024 * 1024) {
    const kb = size / 1024;
    return `${kb >= 10 ? kb.toFixed(0) : kb.toFixed(1)} KB`;
  }
  const mb = size / (1024 * 1024);
  return `${mb >= 10 ? mb.toFixed(0) : mb.toFixed(1)} MB`;
}

export function formatClock(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  if (Number.isNaN(date.getTime())) return "—";
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const seconds = date.getSeconds().toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

export function formatDay(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  if (Number.isNaN(date.getTime())) return "—";
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatRelative(unixSeconds: number, nowMs: number): string {
  const delta = Math.round(nowMs / 1000 - unixSeconds);
  const abs = Math.abs(delta);
  const suffix = delta < 0 ? "from now" : "ago";
  if (abs < 10) return delta < 0 ? "in a moment" : "just now";
  if (abs < 60) return `${abs}s ${suffix}`;
  if (abs < 3600) return `${Math.floor(abs / 60)}m ${suffix}`;
  if (abs < 86_400) return `${Math.floor(abs / 3600)}h ${suffix}`;
  return `${Math.floor(abs / 86_400)}d ${suffix}`;
}

export function formatExpiration(
  created: number,
  expiration: number | undefined,
  nowSec: number,
): string {
  if (expiration == null) return "no expiry";
  const end = created + expiration;
  if (nowSec >= end) return "expired";
  const left = end - nowSec;
  if (left < 60) return `expires in ${left}s`;
  if (left < 3600) return `expires in ${Math.ceil(left / 60)}m`;
  return `expires in ${Math.ceil(left / 3600)}h`;
}

export function formatHexPreview(hex: string, maxBytes = 64): { text: string; truncated: boolean; totalBytes: number } {
  const clean = hex.toLowerCase();
  const totalBytes = Math.floor(clean.length / 2);
  const shown = Math.min(totalBytes, maxBytes);
  const pairs: string[] = [];
  for (let i = 0; i < shown; i++) pairs.push(clean.slice(i * 2, i * 2 + 2));
  const lines: string[] = [];
  for (let i = 0; i < pairs.length; i += 16) lines.push(pairs.slice(i, i + 16).join(" "));
  return { text: lines.join("\n"), truncated: totalBytes > maxBytes, totalBytes };
}

export function shortHash(hash: string, head = 6, tail = 4): string {
  if (hash.length <= head + tail + 1) return hash;
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

export function serverLabel(server: string): string {
  if (server === "demo") return "Demo";
  try {
    const url = new URL(server);
    const port = url.port ? `:${url.port}` : "";
    return `${url.hostname}${port}`;
  } catch {
    return server;
  }
}
