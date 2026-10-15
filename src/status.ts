export type LinkState =
  | { kind: "demo" }
  | { kind: "connecting"; url: string }
  | { kind: "unsupported"; url: string; software: string; detail: string }
  | { kind: "live"; url: string; software: string }
  | { kind: "polling"; url: string; software: string }
  | { kind: "reconnecting"; url: string; software: string; attempt: number }
  | { kind: "disconnected"; url: string }
  | { kind: "error"; url: string; detail: string };

export function statusCopy(state: LinkState): { label: string; detail: string } {
  switch (state.kind) {
    case "demo":
      return {
        label: "Demo",
        detail: "Sample pool on this device. Nothing is read from the network.",
      };
    case "connecting":
      return { label: "Connecting", detail: state.url };
    case "unsupported":
      return {
        label: "No CAPD",
        detail: `${state.software} is connected, and capd.info is not available.`,
      };
    case "live":
      return { label: "Live", detail: `${state.software} · capd.subscribe` };
    case "polling":
      return {
        label: "Polling",
        detail: `${state.software} · capd.subscribe is unavailable, so capd.list runs every 4s`,
      };
    case "reconnecting":
      return {
        label: "Reconnecting",
        detail: `${state.software} · attempt ${state.attempt}`,
      };
    case "disconnected":
      return { label: "Disconnected", detail: state.url || "Not connected" };
    case "error":
      return { label: "Offline", detail: state.detail };
  }
}

export const POLL_MS = 4_000;
export const RECONCILE_MS = 20_000;
