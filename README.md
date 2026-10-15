# CAPD chat

A static site that watches [Nexa](https://nexa.org) CAPD messages like a group chat and keeps them in the browser after they leave the pool.

CAPD (Counterparty and Protocol Discovery) is a short-lived message pool on Nexa full nodes. Messages are relayed by proof-of-work priority, then dropped. This page archives what it sees in IndexedDB, so a reload still shows them.

## What you can do

- Read the pool from a Rostrum server over WebSocket (Electrum JSON-RPC).
- Fall back to a built-in demo pool when the server has no CAPD methods.
- See each message with its timestamp, priority, initial priority, and difficulty (`nBits`). UTF-8 text is shown as text. Any other payload is shown as hex.
- Search text, hex, or a message hash, and filter to text, hex, messages still in the pool, or messages only kept locally.
- Receive new messages with `capd.subscribe` when the server offers it. Otherwise the page polls `capd.list` every 4 seconds.
- Pick a server, including `wss://electrum.nexa.org:20004`, or type a `ws://` / `wss://` URL. A bare host uses port 20004.

The feed is oldest at the top and newest at the bottom.

## Rostrum methods

The client speaks the read-only CAPD methods from [Rostrum MR !544](https://gitlab.com/nexa/rostrum/-/merge_requests/544):

| Method | What it does |
| --- | --- |
| `capd.info` | Pool size, count, and minimum, maximum, and relay priority |
| `capd.list` | Message hashes, lowest priority first. The server caps the list at 20,000 and drops the lowest-priority hashes past that cap |
| `capd.get` | One message: `hash`, `created`, optional `expiration`, `difficultyBits`, `priority`, `initialPriority`, `powTarget`, `nonce`, `size`, `data` |

`expiration` is seconds after `created`. The node uses `65535` for “never”, and Rostrum omits that value.

`capd.subscribe` is not in that merge request. The page calls it anyway. JSON-RPC `-32601` (or any other subscribe failure while the socket is still up) switches the page to polling. A later server can notify with `capd.subscribe` and a hash, a list of hashes, or a `capd.get` object.

Public Rostrum 14.0.1 at `electrum.nexa.org` answers `server.version` and rejects `capd.info` as an unknown method. The page says so and offers the demo pool. CAPD reads are aimed at Rostrum 15.

`capd.list` is treated as a full snapshot only when its length matches `capd.info`’s count. A shorter list means the lowest-priority hashes were omitted, so missing hashes are not marked as gone.

## Posting

`capd.send` is not registered by MR !544, and the page does not grind proof-of-work in the browser. Nexa’s node RPC mines the proof-of-work inside `capd send` from the payload bytes. The composer still calls `capd.send` with the UTF-8 payload hex-encoded (or with raw hex if you check **Send as hex**), so a future server that relays can accept it. Today’s read-only server returns method-not-found, and the composer says that.

Demo messages are stored only on this device.

## Local archive

Messages are stored in IndexedDB (`capd-chat`). Clearing local history removes that database. If IndexedDB cannot be opened, the transcript lasts until the tab closes.

## Develop

```sh
npm install
npm test
npm run dev
```

`npm run build` typechecks and writes a static `dist/` directory. Paths are relative, so the same build works at a GitHub project-page subpath.

## GitHub Pages

`.github/workflows/pages.yml` runs the tests and build on every pull request. A push to `main` uploads `dist/` and deploys it with GitHub Pages. In the repository settings, set Pages to **GitHub Actions**.

The hosted page is HTTPS, so a custom server URL has to be `wss://`.
