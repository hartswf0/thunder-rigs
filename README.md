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

```bash
cd worker
npm install
npx wrangler login                       # opens a browser; approve once
npx wrangler kv namespace create ROOMKV  # copy the printed id
#  → paste that id into worker/wrangler.toml (replace PLACEHOLDER_*)
npx wrangler deploy                      # prints https://thunder-rigs-relay.<you>.workers.dev
```

Confirm it's alive:

```bash
curl https://thunder-rigs-relay.<you>.workers.dev/health
# {"ok":true,"service":"thunder-relay-free","tier":"kv",...}
```

If your workers.dev subdomain isn't `hartswf0`, update
`<meta name="thunder-worker-url">` in `index.html` to the URL `wrangler deploy` printed.

### 2. The game → GitHub Pages

Already wired: `index.html` points at `thunder-rigs-relay.hartswf0.workers.dev`
and `<meta name="thunder-tier" content="free">` (throttles position sync to fit
the free KV write budget). Push to `main` and enable Pages (Settings → Pages →
Deploy from branch → `main` / root). Live at
`https://hartswf0.github.io/thunder-rigs/`.

## Free vs paid relay

| | Free (`worker/src/index.js`, KV) | Paid (`worker/src/index.do.js`, Durable Objects) |
|---|---|---|
| Cost | **$0** | Workers Paid, ~$5/mo |
| Movement | throttled (~1.2s) — steppy | smooth (~100ms) |
| Consistency | eventual | strong |
| Set tier meta to | `free` | `paid` |

To upgrade later: `cd worker && npx wrangler deploy --config wrangler.do.toml`,
then flip `<meta name="thunder-tier">` to `paid` and re-push. Same URL, same room
contract — no other change.

## Testing locally (no Cloudflare account)

```bash
cd worker && npm install
npx wrangler dev            # local relay at http://localhost:8787
```

Then open the game against the local relay by appending `?worker=`:

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
