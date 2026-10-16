import { NEXA_ROSTRUM, NORDIC_ROSTRUM, type ServerPreset } from "./types";

/** Built-in server for a preset. Custom and demo have no fixed URL. */
export function presetServerUrl(preset: ServerPreset): string | null {
  if (preset === "nordic") return NORDIC_ROSTRUM;
  if (preset === "nexa") return NEXA_ROSTRUM;
  return null;
}

/**
 * Accept a ws/wss URL, or a host with an optional port.
 * A bare host uses Nexa mainnet's secure WebSocket port, 20004.
 * A full URL keeps the port the user wrote, including the default when it is omitted.
 */
export function normalizeServerUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  let candidate = trimmed;
  if (!hasScheme) {
    const slash = trimmed.indexOf("/");
    const authority = slash === -1 ? trimmed : trimmed.slice(0, slash);
    const path = slash === -1 ? "" : trimmed.slice(slash);
    if (!authority) return null;
    const portSpecified = authority.startsWith("[") ? /\]:\d+$/.test(authority) : authority.includes(":");
    const withPort = portSpecified ? authority : `${authority}:20004`;
    candidate = `wss://${withPort}${path}`;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "ws:" && url.protocol !== "wss:") return null;
  if (!url.hostname || url.username || url.password) return null;
  url.hash = "";
  const serialized = url.toString();
  return url.pathname === "/" && serialized.endsWith("/") ? serialized.slice(0, -1) : serialized;
}

export function pageRequiresSecureSocket(): boolean {
  return typeof location !== "undefined" && location.protocol === "https:";
}
