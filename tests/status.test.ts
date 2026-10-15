import { describe, expect, it } from "vitest";
import { statusCopy } from "../src/status";

describe("statusCopy", () => {
  it("names the subscription and the polling fallback", () => {
    expect(statusCopy({ kind: "live", url: "wss://example:20004", software: "Rostrum 15" }).detail).toContain(
      "capd.subscribe",
    );
    expect(statusCopy({ kind: "polling", url: "wss://example:20004", software: "Rostrum 15" }).detail).toMatch(
      /capd.subscribe is unavailable.*4s/,
    );
    expect(statusCopy({ kind: "demo" }).label).toBe("Demo");
    expect(statusCopy({ kind: "unsupported", url: "wss://example:20004", software: "Rostrum 14.0.1", detail: "no" }).label).toBe(
      "No CAPD",
    );
  });
});
