import { isMessageHash, payloadForSend } from "./decode";
import { demoInfo, demoSeed, localDemoMessage, nextDemoMessage } from "./demo";
import { ElectrumClient, ElectrumError, connectElectrum, hashesFromNotification, isMethodMissing, negotiateVersion } from "./electrum";
import { visibleMessages, type KindFilter, type PresenceFilter } from "./filter";
import { formatBytes, formatClock, formatDay, formatDifficulty, formatExpiration, formatHexPreview, formatPriority, formatRelative, serverLabel, shortHash } from "./format";
import { mergePulled, parseCapdMessage, pullPool, stampMessage, type CapdRpc } from "./pool";
import { POLL_MS, RECONCILE_MS, statusCopy, type LinkState } from "./status";
import { loadSettings, saveSettings, type MessageStore } from "./store";
import { DEMO_SERVER, type CapdInfo, type ServerPreset, type Settings, type StoredMessage } from "./types";
import { normalizeServerUrl, pageRequiresSecureSocket, presetServerUrl } from "./url";

const DEMO_TICK_MS = 9_000;

export class ChatApp {
  private settings: Settings = loadSettings();
  private link: LinkState = { kind: "demo" };
  private info: CapdInfo | null = null;
  private messages: StoredMessage[] = [];
  private query = "";
  private kind: KindFilter = "all";
  private presence: PresenceFilter = "all";
  private readonly expanded = new Set<string>();
  private notice: { title: string; body: string } | null = null;
  private composerError = "";
  private remaining = 0;
  private syncing = false;
  private sending = false;
  private pinned = true;
  private scrollTicket = 0;
  private generation = 0;
  private demoSequence = 0;
  private client: ElectrumClient | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private demoTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempt = 0;
  private software = "";

  private readonly presetSelect: HTMLSelectElement;
  private readonly presetNote: HTMLElement;
  private readonly urlInput: HTMLInputElement;
  private readonly customRow: HTMLElement;
  private readonly actionButton: HTMLButtonElement;
  private readonly formHint: HTMLElement;
  private readonly statusLabel: HTMLElement;
  private readonly statusDetail: HTMLElement;
  private readonly statusPill: HTMLElement;
  private readonly stats: HTMLElement;
  private readonly archiveNote: HTMLElement;
  private readonly clearPanel: HTMLElement;
  private readonly noticeEl: HTMLElement;
  private readonly scroller: HTMLElement;
  private readonly feed: HTMLOListElement;
  private readonly loadWrap: HTMLElement;
  private readonly jump: HTMLButtonElement;
  private readonly draft: HTMLTextAreaElement;
  private readonly asHex: HTMLInputElement;
  private readonly composerNote: HTMLElement;
  private readonly composerErrorEl: HTMLElement;
  private readonly sendButton: HTMLButtonElement;
  private readonly search: HTMLInputElement;
  private readonly kindButtons: HTMLButtonElement[];
  private readonly presenceButtons: HTMLButtonElement[];

  constructor(
    root: HTMLElement,
    private readonly store: MessageStore,
    private readonly persistent: boolean,
  ) {
    root.innerHTML = SHELL;
    const q = <T extends Element>(selector: string) => {
      const node = root.querySelector(selector);
      if (!node) throw new Error(`Missing ${selector}`);
      return node as T;
    };
    this.presetSelect = q("#preset");
    this.presetNote = q("#preset-note");
    this.urlInput = q("#server-url");
    this.customRow = q("#custom-row");
    this.actionButton = q("#connect-btn");
    this.formHint = q("#connect-hint");
    this.statusLabel = q("#status-label");
    this.statusDetail = q("#status-detail");
    this.statusPill = q("#status-pill");
    this.stats = q("#stats");
    this.archiveNote = q("#archive-note");
    this.clearPanel = q("#clear-confirm");
    this.noticeEl = q("#notice");
    this.scroller = q("#scroller");
    this.feed = q("#feed");
    this.loadWrap = q("#load-more");
    this.jump = q("#jump");
    this.draft = q("#draft");
    this.asHex = q("#as-hex");
    this.composerNote = q("#composer-note");
    this.composerErrorEl = q("#composer-error");
    this.sendButton = q("#send-btn");
    this.search = q("#search");
    this.kindButtons = [...root.querySelectorAll<HTMLButtonElement>("[data-kind]")];
    this.presenceButtons = [...root.querySelectorAll<HTMLButtonElement>("[data-presence]")];
    this.bind(root);
  }

  async start(): Promise<void> {
    this.messages = await this.store.getAll();
    this.settings = loadSettings();
    this.applyForm();
    if (this.settings.active === "server" && this.settings.autoConnect && this.settings.serverUrl) {
      await this.connect(this.settings.serverUrl);
      return;
    }
    if (this.settings.active === "server" && this.settings.serverUrl) {
      this.link = { kind: "disconnected", url: this.settings.serverUrl };
      this.render();
      return;
    }
    await this.enterDemo();
  }

  private bind(root: HTMLElement): void {
    root.querySelector("#connect-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.onAction();
    });
    this.presetSelect.addEventListener("change", () => {
      this.customRow.hidden = this.presetSelect.value !== "custom";
      this.renderChrome();
    });
    this.search.addEventListener("input", () => {
      this.query = this.search.value;
      this.renderFeed();
    });
    for (const button of this.kindButtons) {
      button.addEventListener("click", () => {
        this.kind = button.dataset.kind as KindFilter;
        this.renderFeed();
        this.renderChrome();
      });
    }
    for (const button of this.presenceButtons) {
      button.addEventListener("click", () => {
        const next = button.dataset.presence as PresenceFilter;
        this.presence = this.presence === next ? "all" : next;
        this.renderFeed();
        this.renderChrome();
      });
    }
    this.scroller.addEventListener("scroll", () => {
      const distance = this.scroller.scrollHeight - this.scroller.scrollTop - this.scroller.clientHeight;
      this.pinned = distance < 64;
      this.jump.hidden = this.pinned;
    });
    this.jump.addEventListener("click", () => {
      this.pinned = true;
      this.scroller.scrollTop = this.scroller.scrollHeight;
      this.jump.hidden = true;
    });
    root.querySelector("#composer")?.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.send();
    });
    this.draft.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void this.send();
      }
    });
    root.querySelector("#clear-btn")?.addEventListener("click", () => {
      this.clearPanel.hidden = false;
    });
    root.querySelector("#clear-no")?.addEventListener("click", () => {
      this.clearPanel.hidden = true;
    });
    root.querySelector("#clear-yes")?.addEventListener("click", () => {
      this.clearPanel.hidden = true;
      void this.clearHistory();
    });
    root.querySelector("#notice-demo")?.addEventListener("click", () => {
      void this.enterDemo();
    });
    window.addEventListener("keydown", (event) => {
      const target = event.target;
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
      if (event.key === "/" && !typing) {
        event.preventDefault();
        this.search.focus();
      }
    });
  }

  private applyForm(): void {
    this.presetSelect.value = this.settings.preset;
    this.urlInput.value = this.settings.customUrl;
    this.customRow.hidden = this.settings.preset !== "custom";
  }

  private readForm(): { preset: ServerPreset; customUrl: string } {
    const value = this.presetSelect.value;
    const preset: ServerPreset = value === "nordic" || value === "nexa" || value === "custom" ? value : "demo";
    return { preset, customUrl: this.urlInput.value };
  }

  private currentTarget():
    | { kind: "demo" }
    | { kind: "server"; url: string }
    | { kind: "invalid"; error: string } {
    const form = this.readForm();
    if (form.preset === "demo") return { kind: "demo" };
    const raw = presetServerUrl(form.preset) ?? form.customUrl;
    const url = normalizeServerUrl(raw);
    if (!url) return { kind: "invalid", error: "Enter a WebSocket URL, such as wss://host:20004." };
    if (pageRequiresSecureSocket() && url.startsWith("ws://")) {
      return { kind: "invalid", error: "This page is HTTPS, so the server URL has to use wss://." };
    }
    return { kind: "server", url };
  }

  private selectionIsLive(): boolean {
    const target = this.currentTarget();
    if (target.kind === "demo") return this.link.kind === "demo";
    if (target.kind !== "server") return false;
    if (this.link.kind === "disconnected" || this.link.kind === "error") return false;
    const url = "url" in this.link ? this.link.url : "";
    return url === target.url && this.link.kind !== "demo";
  }

  private async onAction(): Promise<void> {
    const target = this.currentTarget();
    if (target.kind === "demo" && this.link.kind === "demo") return;
    if (this.selectionIsLive()) {
      this.disconnect();
      return;
    }
    this.formHint.textContent = "";
    if (target.kind === "invalid") {
      this.formHint.textContent = target.error;
      return;
    }
    if (target.kind === "demo") {
      await this.enterDemo();
      return;
    }
    const form = this.readForm();
    this.settings = {
      ...this.settings,
      preset: form.preset,
      customUrl: form.customUrl,
      active: "server",
      serverUrl: target.url,
      autoConnect: true,
    };
    saveSettings(this.settings);
    await this.connect(target.url);
  }

  private disconnect(): void {
    this.generation += 1;
    this.stopLoops();
    this.client?.close();
    this.client = null;
    const url = "url" in this.link ? this.link.url : this.settings.serverUrl;
    this.link = { kind: "disconnected", url };
    this.settings = { ...this.settings, autoConnect: false };
    saveSettings(this.settings);
    this.syncing = false;
    this.render();
  }

  private async enterDemo(): Promise<void> {
    this.generation += 1;
    this.stopLoops();
    this.client?.close();
    this.client = null;
    this.notice = null;
    this.composerError = "";
    this.remaining = 0;
    const form = this.readForm();
    this.settings = {
      ...this.settings,
      preset: "demo",
      customUrl: form.customUrl,
      active: "demo",
      autoConnect: false,
    };
    this.presetSelect.value = "demo";
    this.customRow.hidden = true;
    saveSettings(this.settings);
    if (!this.messages.some((message) => message.server === DEMO_SERVER)) {
      const seed = demoSeed(Date.now());
      this.messages = this.messages.concat(seed);
      await this.store.putMany(seed);
    }
    this.demoSequence = this.messages.filter((message) => message.server === DEMO_SERVER).length;
    this.info = demoInfo(this.messages);
    this.link = { kind: "demo" };
    this.startDemoTicker();
    this.pinned = true;
    this.render();
  }

  private startDemoTicker(): void {
    this.stopDemo();
    const tick = () => {
      if (this.link.kind !== "demo") return;
      const message = nextDemoMessage(this.demoSequence, Date.now());
      this.demoSequence += 1;
      this.messages = this.messages.concat(message);
      this.info = demoInfo(this.messages);
      void this.store.putMany([message]);
      this.renderFeed();
      this.renderChrome();
      this.demoTimer = setTimeout(tick, DEMO_TICK_MS);
    };
    this.demoTimer = setTimeout(tick, DEMO_TICK_MS);
  }

  private async connect(url: string): Promise<void> {
    const generation = ++this.generation;
    this.stopLoops();
    this.client?.close();
    this.client = null;
    this.notice = null;
    this.composerError = "";
    this.link = { kind: "connecting", url };
    this.render();
    let reconnecting = false;
    try {
      const client = await connectElectrum(url);
      if (generation !== this.generation) {
        client.close();
        return;
      }
      this.client = client;
      client.onClose(() => {
        if (generation !== this.generation) return;
        reconnecting = true;
        this.scheduleReconnect(url);
      });
      try {
        this.software = await negotiateVersion(client);
      } catch {
        this.software = "Rostrum";
      }
      if (generation !== this.generation) return;
      try {
        await this.sync(url, generation);
      } catch (error) {
        if (generation !== this.generation) return;
        if (isMethodMissing(error)) {
          client.close();
          this.client = null;
          this.link = {
            kind: "unsupported",
            url,
            software: this.software,
            detail: error instanceof Error ? error.message : "CAPD is not available",
          };
          this.notice = {
            title: "This server does not expose CAPD",
            body: `${this.software} answered server.version. capd.info failed: ${this.link.detail}. Rostrum MR !544 adds the read methods capd.info, capd.list, and capd.get.`,
          };
          this.render();
          return;
        }
        throw error;
      }
      if (generation !== this.generation) return;
      const subscribed = await this.trySubscribe(client);
      if (generation !== this.generation) return;
      this.reconnectAttempt = 0;
      this.link = subscribed
        ? { kind: "live", url, software: this.software }
        : { kind: "polling", url, software: this.software };
      this.startPolling(url, generation, subscribed ? RECONCILE_MS : POLL_MS);
      this.startPing(generation);
      this.render();
    } catch (error) {
      if (generation !== this.generation || reconnecting || this.client?.isClosed) return;
      this.client?.close();
      this.client = null;
      const detail = error instanceof Error ? error.message : "Could not connect";
      this.link = { kind: "error", url, detail };
      this.notice = {
        title: "Could not reach the server",
        body: detail,
      };
      this.render();
    }
  }

  private async trySubscribe(client: ElectrumClient): Promise<boolean> {
    try {
      await client.request("capd.subscribe", []);
      client.onNotification((method, params) => {
        if (!method.toLowerCase().includes("capd")) return;
        const hashes = hashesFromNotification(params);
        if (hashes.length === 0) return;
        void this.fetchHashes(client, hashes);
      });
      return true;
    } catch (error) {
      if (client.isClosed) throw error;
      return false;
    }
  }

  private scheduleReconnect(url: string): void {
    this.stopLoops();
    this.client = null;
    this.reconnectAttempt += 1;
    const attempt = this.reconnectAttempt;
    const delay = Math.min(20_000, 1000 * 2 ** (attempt - 1));
    this.link = { kind: "reconnecting", url, software: this.software || "Rostrum", attempt };
    this.render();
    const generation = this.generation;
    this.reconnectTimer = setTimeout(() => {
      if (generation !== this.generation) return;
      void this.connect(url);
    }, delay);
  }

  private startPolling(url: string, generation: number, interval: number): void {
    const tick = async () => {
      if (generation !== this.generation) return;
      try {
        await this.sync(url, generation);
      } catch (error) {
        if (generation !== this.generation || !this.client || this.client.isClosed) return;
        this.composerError = error instanceof Error ? error.message : "The pool refresh failed";
        this.renderChrome();
      }
      if (generation !== this.generation) return;
      this.pollTimer = setTimeout(() => void tick(), interval);
    };
    this.pollTimer = setTimeout(() => void tick(), interval);
  }

  private startPing(generation: number): void {
    this.pingTimer = setInterval(() => {
      if (generation !== this.generation) return;
      void this.client?.request("server.ping", [], 5_000).catch(() => undefined);
    }, 25_000);
  }

  private rpc(): CapdRpc | null {
    const client = this.client;
    if (!client) return null;
    return {
      info: () => client.request("capd.info"),
      list: () => client.request("capd.list"),
      get: (hash) => client.request("capd.get", [hash]),
    };
  }

  private async sync(url: string, generation: number): Promise<void> {
    const rpc = this.rpc();
    if (!rpc) return;
    this.syncing = true;
    this.renderChrome();
    try {
      const mine = this.messages.filter((message) => message.server === url);
      const inPool = new Set(mine.filter((message) => message.inPool).map((message) => message.hash));
      const pulled = await pullPool(rpc, url, inPool, inPool, Date.now());
      if (generation !== this.generation) return;
      this.info = pulled.info;
      this.remaining = pulled.remaining;
      this.messages = mergePulled(this.messages, pulled.messages, pulled.departed, Date.now());
      const departed = new Set(pulled.departed ?? []);
      const fetched = new Set(pulled.messages.map((message) => message.hash));
      await this.store.putMany(
        this.messages.filter(
          (message) => message.server === url && (fetched.has(message.hash) || departed.has(message.hash)),
        ),
      );
      this.render();
    } finally {
      this.syncing = false;
      if (generation === this.generation) this.renderChrome();
    }
  }

  private async fetchHashes(client: ElectrumClient, hashes: string[]): Promise<void> {
    const url = this.settings.serverUrl;
    const generation = this.generation;
    const fresh: StoredMessage[] = [];
    for (const hash of hashes) {
      if (generation !== this.generation) return;
      try {
        const raw = await client.request("capd.get", [hash]);
        const parsed = parseCapdMessage(raw);
        if (parsed.ok) fresh.push(stampMessage(parsed.message, url, Date.now()));
      } catch (error) {
        if (error instanceof ElectrumError && error.code === -32004) continue;
        if (client.isClosed) return;
      }
    }
    if (fresh.length === 0 || generation !== this.generation) return;
    this.messages = mergePulled(this.messages, fresh, null, Date.now());
    await this.store.putMany(fresh);
    this.render();
  }

  private async loadMore(): Promise<void> {
    if (this.link.kind !== "live" && this.link.kind !== "polling") return;
    const url = this.link.url;
    try {
      await this.sync(url, this.generation);
    } catch (error) {
      this.composerError = error instanceof Error ? error.message : "Could not load more messages";
      this.renderChrome();
    }
  }

  private async send(): Promise<void> {
    if (this.sending) return;
    const payload = payloadForSend(this.draft.value, this.asHex.checked);
    if (!payload.ok) {
      this.composerError = payload.error;
      this.renderChrome();
      return;
    }
    this.sending = true;
    this.composerError = "";
    this.renderChrome();
    try {
      if (this.link.kind === "demo") {
        const message = localDemoMessage(payload.param, Date.now());
        this.messages = this.messages.concat(message);
        this.info = demoInfo(this.messages);
        await this.store.putMany([message]);
        this.draft.value = "";
        this.pinned = true;
        this.render();
        return;
      }
      if ((this.link.kind !== "live" && this.link.kind !== "polling") || !this.client) {
        this.composerError = "Connect to a CAPD server, or switch to the demo, before sending.";
        return;
      }
      const client = this.client;
      const url = this.link.url;
      try {
        const result = await client.request("capd.send", [payload.param], 60_000);
        this.draft.value = "";
        if (typeof result === "string" && isMessageHash(result)) {
          const raw = await client.request("capd.get", [result.toLowerCase()]);
          const parsed = parseCapdMessage(raw);
          if (parsed.ok) {
            const message = stampMessage(parsed.message, url, Date.now(), "local");
            this.messages = mergePulled(this.messages, [message], null, Date.now());
            await this.store.putMany([message]);
          }
        }
        this.pinned = true;
        await this.sync(url, this.generation);
      } catch (error) {
        if (isMethodMissing(error)) {
          this.composerError =
            "This server refused capd.send. Rostrum MR !544 only registers capd.info, capd.list, and capd.get. When send exists, the full node mines the proof-of-work.";
        } else {
          this.composerError = error instanceof Error ? error.message : "Send failed";
        }
      }
    } finally {
      this.sending = false;
      this.render();
    }
  }

  private async clearHistory(): Promise<void> {
    await this.store.clearAll();
    this.messages = [];
    this.expanded.clear();
    this.remaining = 0;
    if (this.link.kind === "demo") {
      const seed = demoSeed(Date.now());
      this.messages = seed;
      this.demoSequence = seed.length;
      await this.store.putMany(seed);
      this.info = demoInfo(this.messages);
    } else {
      this.info = null;
    }
    this.pinned = true;
    this.render();
  }

  private stopLoops(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.demoTimer) clearTimeout(this.demoTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pollTimer = null;
    this.demoTimer = null;
    this.reconnectTimer = null;
    this.pingTimer = null;
  }

  private stopDemo(): void {
    if (this.demoTimer) clearTimeout(this.demoTimer);
    this.demoTimer = null;
  }

  private viewServer(): string | null {
    if (this.link.kind === "demo") return DEMO_SERVER;
    if ("url" in this.link && this.link.url) return this.link.url;
    return this.settings.serverUrl || null;
  }

  private render(): void {
    this.renderChrome();
    this.renderFeed();
  }

  private renderChrome(): void {
    const copy = statusCopy(this.link);
    this.statusPill.dataset.tone = this.link.kind;
    this.statusLabel.textContent = copy.label;
    const detail = this.syncing && this.link.kind !== "connecting" ? `${copy.detail} Updating…` : copy.detail;
    this.statusDetail.textContent = detail;
    this.customRow.hidden = this.presetSelect.value !== "custom";
    const presetUrl = this.readForm().preset === "nordic" ? presetServerUrl("nordic") : null;
    this.presetNote.hidden = presetUrl === null;
    this.presetNote.textContent = presetUrl ?? "";
    const demoRunning = this.link.kind === "demo" && this.presetSelect.value === "demo";
    const live = this.selectionIsLive();
    this.actionButton.disabled = demoRunning;
    this.actionButton.textContent = demoRunning ? "Demo running" : live ? "Disconnect" : this.presetSelect.value === "demo" ? "Use demo" : "Connect";
    this.actionButton.classList.toggle("primary", !live);
    this.actionButton.classList.toggle("ghost", live);

    const server = this.viewServer();
    const kept = this.messages.filter((message) => (server ? message.server === server : true));
    const inPool = kept.filter((message) => message.inPool).length;
    this.stats.replaceChildren();
    const rows: [string, string][] = [
      ["In pool", this.info ? String(this.info.count) : String(inPool)],
      ["Pool size", this.info ? formatBytes(this.info.size) : "—"],
      ["Relay", this.info ? formatPriority(this.info.relayPriority) : "—"],
      ["Priority", this.info ? `${formatPriority(this.info.minPriority)} – ${formatPriority(this.info.maxPriority)}` : "—"],
      ["Kept here", String(kept.length)],
    ];
    for (const [label, value] of rows) {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      this.stats.append(dt, dd);
    }
    const where = server ? serverLabel(server) : "this browser";
    this.archiveNote.textContent = this.persistent
      ? `${kept.length} messages from ${where} are stored in IndexedDB on this device.`
      : "IndexedDB did not open. Messages last until this tab closes.";

    this.noticeEl.hidden = !this.notice;
    this.noticeEl.replaceChildren();
    if (this.notice) {
      const title = document.createElement("h2");
      title.textContent = this.notice.title;
      const body = document.createElement("p");
      body.textContent = this.notice.body;
      this.noticeEl.append(title, body);
      if (this.link.kind === "unsupported" || this.link.kind === "error") {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ghost";
        button.id = "notice-demo";
        button.textContent = "Watch the demo pool";
        button.addEventListener("click", () => void this.enterDemo());
        this.noticeEl.append(button);
      }
    }

    for (const button of this.kindButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.kind === this.kind));
    }
    for (const button of this.presenceButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.presence === this.presence));
    }

    const canSend = this.link.kind === "demo" || this.link.kind === "live" || this.link.kind === "polling";
    this.sendButton.disabled = !canSend || this.sending;
    this.sendButton.textContent = this.sending ? "Sending…" : "Send";
    this.composerNote.textContent = composerNote(this.link);
    this.composerErrorEl.hidden = !this.composerError;
    this.composerErrorEl.textContent = this.composerError;
  }

  private renderFeed(): void {
    const server = this.viewServer();
    const shown = visibleMessages(this.messages, {
      query: this.query,
      kind: this.kind,
      presence: this.presence,
      server,
    });
    const pinned = this.pinned;
    const top = this.scroller.scrollTop;
    this.loadWrap.replaceChildren();
    if (this.remaining > 0 && (this.link.kind === "live" || this.link.kind === "polling")) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ghost load-more";
      button.textContent = `Load more from the pool (${this.remaining} not fetched)`;
      button.addEventListener("click", () => void this.loadMore());
      this.loadWrap.append(button);
    }
    this.feed.replaceChildren();
    if (shown.length === 0) {
      const empty = document.createElement("li");
      empty.className = "empty";
      const title = document.createElement("p");
      title.className = "empty-title";
      const body = document.createElement("p");
      const hasAny = this.messages.some((message) => (server ? message.server === server : true));
      title.textContent = hasAny ? "Nothing matches" : "No messages yet";
      body.textContent = hasAny
        ? "Try a different search, or show all kinds of payloads."
        : "Messages you fetch from the pool stay in this browser after they expire.";
      empty.append(title, body);
      this.feed.append(empty);
    } else {
      const now = Date.now();
      for (const message of shown) this.feed.append(renderMessage(message, now, this.expanded.has(message.hash), this));
    }
    const count = document.createElement("span");
    count.className = "sr-only";
    count.textContent = `${shown.length} messages shown`;
    this.feed.append(count);
    this.restoreScroll(pinned, top);
    this.jump.hidden = pinned;
  }

  toggleExpanded(hash: string): void {
    if (this.expanded.has(hash)) this.expanded.delete(hash);
    else this.expanded.add(hash);
    this.renderFeed();
  }

  private restoreScroll(pinned: boolean, top: number): void {
    const ticket = ++this.scrollTicket;
    requestAnimationFrame(() => {
      if (ticket !== this.scrollTicket) return;
      this.scroller.scrollTop = pinned ? this.scroller.scrollHeight : top;
    });
  }
}

function composerNote(link: LinkState): string {
  if (link.kind === "demo") {
    return "Demo messages stay on this device. They are not broadcast, and no proof-of-work is mined.";
  }
  if (link.kind === "live" || link.kind === "polling") {
    return "Send calls capd.send. MR !544 does not register it, so current servers refuse. A node that accepts send mines the proof-of-work itself.";
  }
  return "Connect to a server, or use the demo, to add a message.";
}

function renderMessage(message: StoredMessage, nowMs: number, open: boolean, app: ChatApp): HTMLLIElement {
  const item = document.createElement("li");
  item.className = `message${message.origin === "local" ? " is-local" : ""}${message.inPool ? "" : " is-kept"}${message.text === null ? " is-hex" : ""}`;
  item.style.borderLeftColor = accent(message.hash);
  const nowSec = Math.floor(nowMs / 1000);
  const sameDay = formatDay(message.created) === formatDay(nowSec);

  const head = document.createElement("div");
  head.className = "message-head";
  const time = document.createElement("time");
  time.dateTime = new Date(message.created * 1000).toISOString();
  time.textContent = sameDay
    ? `${formatClock(message.created)} · ${formatRelative(message.created, nowMs)}`
    : `${formatDay(message.created)} ${formatClock(message.created)} · ${formatRelative(message.created, nowMs)}`;
  const badges = document.createElement("span");
  badges.className = "badges";
  badges.append(badge(message.inPool ? "In pool" : "Kept", message.inPool ? "pool" : "kept"));
  if (message.origin === "local") badges.append(badge("You", "you"));
  if (message.text === null) badges.append(badge("Hex", "hex"));
  head.append(time, badges);

  const body = document.createElement(message.text === null ? "pre" : "p");
  body.className = message.text === null ? "body hex" : "body";
  if (message.text === null) {
    const preview = formatHexPreview(message.data, open ? 512 : 64);
    body.textContent = preview.text || "(empty payload)";
    if (preview.truncated) body.textContent += `\n… ${preview.totalBytes} bytes`;
  } else {
    body.textContent = message.text;
  }

  const meta = document.createElement("p");
  meta.className = "meta";
  const priority =
    message.priority === message.initialPriority
      ? `priority ${formatPriority(message.priority)}`
      : `priority ${formatPriority(message.priority)} · initial ${formatPriority(message.initialPriority)}`;
  const payloadBytes = message.data.length / 2;
  meta.textContent = `${priority} · difficulty ${formatDifficulty(message.difficultyBits)} · ${formatBytes(payloadBytes)} · ${formatExpiration(message.created, message.expiration, nowSec)} · ${shortHash(message.hash)}`;

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "texty";
  toggle.setAttribute("aria-expanded", String(open));
  toggle.textContent = open ? "Hide details" : "Details";
  toggle.addEventListener("click", () => app.toggleExpanded(message.hash));

  item.append(head, body, meta, toggle);
  if (open) item.append(renderDetails(message, nowSec));
  return item;
}

function renderDetails(message: StoredMessage, nowSec: number): HTMLDivElement {
  const panel = document.createElement("div");
  panel.className = "details";
  const rows: [string, string][] = [
    ["Hash", message.hash],
    ["Created", new Date(message.created * 1000).toISOString()],
    ["Expiration", expirationDetail(message, nowSec)],
    ["Difficulty", `${message.difficultyBits} (0x${formatDifficulty(message.difficultyBits)})`],
    ["Priority", `${formatPriority(message.priority)} now · ${formatPriority(message.initialPriority)} at creation`],
    ["PoW target", message.powTarget],
    ["Nonce", message.nonce || "(empty)"],
    ["Payload", `${message.data.length / 2} bytes`],
    ["Node size", formatBytes(message.size)],
    ["Server", serverLabel(message.server)],
  ];
  const list = document.createElement("dl");
  for (const [label, value] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    list.append(dt, dd);
  }
  const actions = document.createElement("div");
  actions.className = "detail-actions";
  actions.append(copyButton("Copy hash", message.hash), copyButton("Copy payload hex", message.data));
  const hex = document.createElement("pre");
  hex.className = "hex full";
  const preview = formatHexPreview(message.data, 4096);
  hex.textContent = preview.text || "(empty payload)";
  if (preview.truncated) hex.textContent += `\n… showing 4096 of ${preview.totalBytes} bytes`;
  panel.append(list, actions, hex);
  return panel;
}

function expirationDetail(message: StoredMessage, nowSec: number): string {
  if (message.expiration == null) return "Does not expire (the node omits 65535)";
  const end = message.created + message.expiration;
  return `${message.expiration}s after creation · ${new Date(end * 1000).toISOString()} · ${formatExpiration(message.created, message.expiration, nowSec)}`;
}

function badge(text: string, tone: string): HTMLSpanElement {
  const node = document.createElement("span");
  node.className = `badge badge-${tone}`;
  node.textContent = text;
  return node;
}

function copyButton(label: string, value: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ghost tiny";
  button.textContent = label;
  button.addEventListener("click", async () => {
    const ok = await writeClipboard(value);
    button.textContent = ok ? "Copied" : "Copy failed";
    setTimeout(() => {
      button.textContent = label;
    }, 1200);
  });
  return button;
}

async function writeClipboard(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

function accent(hash: string): string {
  const hue = Number.parseInt(hash.slice(0, 2), 16);
  return `hsl(${hue} 32% 62%)`;
}

const SHELL = `
<div class="app">
  <aside class="rail">
    <header class="brand">
      <div class="brand-row">
        <svg class="mark" viewBox="0 0 32 32" aria-hidden="true">
          <circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" stroke-width="1.5"></circle>
          <circle cx="16" cy="16" r="3.5" fill="currentColor"></circle>
        </svg>
        <p class="eyebrow">Nexa message pool</p>
      </div>
      <h1><span>CAPD</span> chat</h1>
      <p class="lede">Watch counterparty and protocol discovery messages, and keep them in this browser after they leave the pool.</p>
    </header>
    <form id="connect-form" class="connect">
      <label for="preset">Server</label>
      <select id="preset">
        <option value="demo">Demo pool</option>
        <option value="nordic">Nordic Crypto</option>
        <option value="nexa">electrum.nexa.org:20004</option>
        <option value="custom">Custom WebSocket</option>
      </select>
      <p id="preset-note" class="hint" hidden></p>
      <div id="custom-row" hidden>
        <label for="server-url">WebSocket URL</label>
        <input id="server-url" name="server" spellcheck="false" autocomplete="off" placeholder="wss://host:20004" />
      </div>
      <button id="connect-btn" class="primary" type="submit">Use demo</button>
      <p id="connect-hint" class="hint"></p>
    </form>
    <section class="stats-block" aria-label="Pool">
      <h2>Pool</h2>
      <dl id="stats"></dl>
    </section>
    <section class="archive">
      <h2>On this device</h2>
      <p id="archive-note"></p>
      <button id="clear-btn" class="ghost" type="button">Clear local history</button>
      <div id="clear-confirm" class="confirm" hidden>
        <p>Remove every CAPD message stored in this browser?</p>
        <div class="confirm-actions">
          <button id="clear-yes" class="danger" type="button">Clear</button>
          <button id="clear-no" class="ghost" type="button">Keep</button>
        </div>
      </div>
    </section>
  </aside>
  <main class="room">
    <div class="room-bar">
      <div id="status-pill" class="status" data-tone="demo">
        <span id="status-label">Demo</span>
        <p id="status-detail"></p>
      </div>
      <div class="tools">
        <label class="sr-only" for="search">Search messages</label>
        <input id="search" type="search" placeholder="Search text, hex, or hash" />
        <div class="filters" role="group" aria-label="Payload">
          <button type="button" data-kind="all" aria-pressed="true">All</button>
          <button type="button" data-kind="text" aria-pressed="false">Text</button>
          <button type="button" data-kind="hex" aria-pressed="false">Hex</button>
        </div>
        <div class="filters" role="group" aria-label="Presence">
          <button type="button" data-presence="pool" aria-pressed="false">In pool</button>
          <button type="button" data-presence="kept" aria-pressed="false">Kept</button>
        </div>
      </div>
    </div>
    <div id="notice" class="notice" hidden></div>
    <div id="scroller" class="scroller">
      <div id="load-more"></div>
      <ol id="feed" class="feed" aria-label="CAPD messages, oldest at the top"></ol>
    </div>
    <button id="jump" class="jump" type="button" hidden>Latest messages</button>
    <form id="composer" class="composer">
      <label class="sr-only" for="draft">Message</label>
      <textarea id="draft" rows="2" maxlength="4000" placeholder="Write a message. Enter sends, Shift+Enter adds a line."></textarea>
      <div class="composer-row">
        <label class="check"><input id="as-hex" type="checkbox" /> Send as hex</label>
        <p id="composer-note"></p>
        <p id="composer-error" class="error" hidden></p>
        <button id="send-btn" class="primary" type="submit">Send</button>
      </div>
    </form>
  </main>
</div>
`;
