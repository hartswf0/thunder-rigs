# THUNDER RIGS — real multiplayer on GitHub Pages

A Three.js builder/racer that plays multiplayer with **no game server to run**.
The whole thing is two static pieces:

```
  index.html   ──HTTP polling──►   Cloudflare Worker relay   ◄──HTTP polling──   index.html
  (a player)                       (/trig/{room}/{op})                            (another player)
     ▲                                                                                  ▲
     └────────────────────── both served by GitHub Pages ──────────────────────────────┘
```

- **`index.html`** is the game. 100% static → served by **GitHub Pages**.
- The game reaches multiplayer by polling a **Cloudflare Worker relay** over plain
  HTTPS (`/trig/{ROOM}/{join,poll,send,leave,snapshot}`). No WebSocket server,
  no long-lived Node process — so it fits GitHub Pages + Cloudflare's free tier.
- The relay is configured by one tag in `index.html`:
  `<meta name="thunder-worker-url" content="https://thunder-rigs-relay.<you>.workers.dev">`

The relay only *forwards* messages between players in the same room code; the game
runs entirely in each browser. That is why a static host is enough.

## Two things to deploy

### 1. The relay → Cloudflare Workers (free)

The default worker is a **SQLite-backed Durable Object** — strongly consistent,
instant presence, and it runs on the Cloudflare Workers **free** plan.

```bash
cd worker
npm install
npx wrangler login     # opens a browser; approve once (skip if already logged in)
npx wrangler deploy    # prints https://thunder-rigs-relay.<you>.workers.dev
```

Confirm it's alive:

```bash
curl https://thunder-rigs-relay.<you>.workers.dev/health
# {"ok":true,"service":"thunder-relay",...}
```

If your workers.dev subdomain isn't `hartswf0`, update
`<meta name="thunder-worker-url">` in `index.html` to the URL `wrangler deploy` printed.

> **Why not Workers KV?** There's a KV version in `worker/src/index.js` /
> `wrangler.kv.toml`, but it's **reference only**: KV's `list()` is eventually
> consistent (~30s+ propagation), so peers take ~30s to see each other — unusable
> for live play. The Durable Object worker is the same $0 and fixes this.

### 2. The game → GitHub Pages

Already wired: `index.html` points at `thunder-rigs-relay.hartswf0.workers.dev`.
Push to `main` and enable Pages (Settings → Pages → Deploy from branch → `main` /
root). Live at `https://hartswf0.github.io/thunder-rigs/`.

## The `thunder-tier` meta — movement smoothness vs free quota

The relay is the free SQLite Durable Object either way; `<meta name="thunder-tier">`
only controls how often **your own car position broadcasts** (presence/roster is
always instant, polled every 150ms):

| `thunder-tier` | Position broadcast | Feel | Free-plan cost (100k req/day) |
|---|---|---|---|
| `free` (current) | ~1.2s | presence instant, movement a little steppy | ~28k req/player·hr → good for real test sessions |
| `paid` | ~100ms | buttery smooth | ~61k req/player·hr → burns the free cap in ~1hr; use with the Paid plan |

- **Staying $0:** keep `tier=free`. Real multiplayer works — you see other players
  join, build, and move; movement just updates ~1×/sec (smoothed by interpolation).
- **Going smooth:** enable the **Workers Paid plan** ($5/mo, 10M req/mo) in the
  Cloudflare dashboard, set `<meta name="thunder-tier" content="paid">`, and re-push.
  Same worker, same URL — no redeploy needed.

## Testing locally (no Cloudflare account)

```bash
cd worker && npm install
npx wrangler dev            # local relay (Durable Object simulated by Miniflare)
```

Then open the game against the local relay by appending `?worker=` (port is
whatever `wrangler dev` prints, e.g. 8787 or 8799):

```
http://localhost:5173/index.html?worker=http://localhost:8787
```

(the `?worker=` query overrides the meta tag). Open it in two browser windows,
join the same ROOM code, and you'll see each other's rigs. The in-game
**NET SELF-TEST** button (in the multiplayer panel) runs a join→send→poll check
and tells you if the relay is live.

## What's the relay contract?

All JSON, all CORS-open, all under `/trig/{room}/{op}`:

| op | method | body / query | returns |
|---|---|---|---|
| `join` | POST | `{name,color,rig}` | `{peerId, role, seq, peers, maxPeers}` |
| `poll` | GET | `?peerId&after=<seq>` | `{seq, peers, messages}` |
| `send` | POST | `{peerId, msg}` | `{ok, seq}` |
| `leave` | POST | `{peerId}` | `{ok}` |
| `snapshot` | GET/POST | `{peerId, snapshot}` | `{snapshot, version}` |

Max 8 peers per room. First to join is `host`.
