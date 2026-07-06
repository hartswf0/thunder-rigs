/* ============================================================================
 * THUNDER RIGS — MULTIPLAYER RELAY WORKER (FREE TIER / KV)
 * ----------------------------------------------------------------------------
 * A drop-in replacement for the Durable Object worker that runs entirely on
 * Cloudflare's FREE plan using Workers KV. Same endpoints, same response shapes,
 * same client -- no game changes needed. Point the game's <meta thunder-worker-url>
 * at this and multiplayer works with zero monthly cost.
 *
 * THE HONEST TRADE-OFF (why the DO version is still "more correct")
 *   KV has NO atomic operations and is eventually consistent. There is no safe
 *   shared counter -- if two peers appended to one shared log, they'd clobber
 *   each other. So this design avoids all shared mutable state:
 *
 *     EACH PEER WRITES ONLY ITS OWN KEYS.
 *       room:{R}:peer:{P}          -> that peer's presence {name,color,rig,role,seen}
 *       room:{R}:peer:{P}:outbox   -> that peer's recent messages (a capped list)
 *       room:{R}:snapshot          -> last arena snapshot (last-writer-wins, fine)
 *
 *     POLL reads ALL peer keys for the room, merges every outbox, filters by the
 *     caller's `after` cursor, and returns the union. No counter to clobber.
 *
 *   CONSEQUENCES you should know:
 *     - Consistency is eventual. Same-region reads-after-write are fast
 *       (sub-second); cross-region can lag briefly.
 *     - seq is per-peer ms-since-epoch, used only as a monotonic "after" cursor.
 *     - KV free tier: 100k reads/day, 1k WRITES/day. Writes are the tight quota,
 *       so position sync must be THROTTLED (see client note at the bottom).
 *
 *   When you outgrow this, deploy the Durable Object version -- same contract,
 *   just flip the meta tag.
 *
 * DEPLOY (free, ~3 min)
 *   1. npm create cloudflare@latest thunder-relay-free   (Hello World Worker)
 *   2. Replace src/index.js with THIS file.
 *   3. npx wrangler kv namespace create ROOMKV   (copy the id it prints)
 *   4. Add the KV binding to wrangler.toml (see WRANGLER block at bottom).
 *   5. npx wrangler deploy
 *   6. Put the deployed URL in the game's <meta name="thunder-worker-url">.
 * ==========================================================================*/

const MAX_PEERS = 8;
const PEER_TTL_MS = 20000;
const OUTBOX_KEEP = 60;
const OUTBOX_TTL_S = 90;
// Cloudflare KV enforces a hard floor of 60s on expirationTtl. Presence liveness
// is governed by PEER_TTL_MS (20s) in listPeers(); this is only the physical
// key-expiry backstop, so it must be >= 60. (Was 30 -> KV rejected every join.)
const PEER_TTL_S = 60;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

const kPeer      = (r, p) => `room:${r}:peer:${p}`;
const kOutbox    = (r, p) => `room:${r}:peer:${p}:outbox`;
const kSnapshot  = (r)    => `room:${r}:snapshot`;
const kEvents    = (r)    => `room:${r}:events`;   // room-level outbox for leave/host events (survives peer deletion)
const peerPrefix = (r)    => `room:${r}:peer:`;

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);

    if (parts[0] === 'health') {
      return json({ ok: true, service: 'thunder-relay-free', tier: 'kv', ts: Date.now() });
    }
    if (parts[0] !== 'trig' || parts.length < 3) {
      return json({ error: 'bad path — expected /trig/{room}/{op}' }, 404);
    }

    const KV = env.ROOMKV;
    if (!KV) return json({ error: 'KV namespace ROOMKV not bound — see wrangler.toml' }, 500);

    const room = decodeURIComponent(parts[1]).toUpperCase().slice(0, 64);
    const op = parts[2];
    const now = Date.now();

    try {
      if (op === 'join')     return await opJoin(KV, room, request, now);
      if (op === 'poll')     return await opPoll(KV, room, url, now);
      if (op === 'send')     return await opSend(KV, room, request, now);
      if (op === 'leave')    return await opLeave(KV, room, request, now);
      if (op === 'snapshot') return request.method === 'GET'
        ? await opSnapshotGet(KV, room)
        : await opSnapshotPost(KV, room, request);
      return json({ error: 'unknown op: ' + op }, 404);
    } catch (e) {
      return json({ error: 'relay error: ' + (e && e.message || e) }, 500);
    }
  },
};

async function listPeers(KV, room, now) {
  const prefix = peerPrefix(room);
  const listed = await KV.list({ prefix });
  const peers = [];
  for (const key of listed.keys) {
    if (key.name.endsWith(':outbox')) continue;
    const raw = await KV.get(key.name);
    if (!raw) continue;
    let p; try { p = JSON.parse(raw); } catch (_) { continue; }
    if (now - (p.seen || 0) > PEER_TTL_MS) continue;
    peers.push(p);
  }
  return peers;
}

function publicPeer(p) {
  return { id: p.id, name: p.name, color: p.color, rig: p.rig, role: p.role };
}

async function appendOutbox(KV, room, peerId, msg, now) {
  const key = kOutbox(room, peerId);
  let list = [];
  try { const raw = await KV.get(key); if (raw) list = JSON.parse(raw); } catch (_) {}
  const lastSeq = list.length ? list[list.length - 1].seq : 0;
  const seq = Math.max(now, lastSeq + 1);
  list.push({ seq, from: peerId, msg, t: now });
  if (list.length > OUTBOX_KEEP) list = list.slice(list.length - OUTBOX_KEEP);
  await KV.put(key, JSON.stringify(list), { expirationTtl: OUTBOX_TTL_S });
  return seq;
}

// Room-level events (peer-leave, host-migrated) live here so they survive the
// deletion of the peer that caused them. poll() always reads this alongside the
// live peers' outboxes.
async function appendRoomEvent(KV, room, msg, now) {
  const key = kEvents(room);
  let list = [];
  try { const raw = await KV.get(key); if (raw) list = JSON.parse(raw); } catch (_) {}
  const lastSeq = list.length ? list[list.length - 1].seq : 0;
  const seq = Math.max(now, lastSeq + 1);
  list.push({ seq, from: 'system', msg, t: now });
  if (list.length > OUTBOX_KEEP) list = list.slice(list.length - OUTBOX_KEEP);
  await KV.put(key, JSON.stringify(list), { expirationTtl: OUTBOX_TTL_S });
  return seq;
}

async function opJoin(KV, room, request, now) {
  const peers = await listPeers(KV, room, now);
  if (peers.length >= MAX_PEERS) return json({ error: 'ROOM FULL' }, 403);

  let body = {};
  try { body = await request.json(); } catch (_) {}

  const peerId = 'p' + Math.random().toString(36).slice(2, 10) + now.toString(36);
  const role = peers.length === 0 ? 'host' : 'guest';

  const peer = {
    id: peerId,
    name: String(body.name || 'PLAYER').slice(0, 24),
    color: String(body.color || '#ffffff').slice(0, 16),
    rig: body.rig || null,
    role, seen: now, joinedAt: now,
  };
  await KV.put(kPeer(room, peerId), JSON.stringify(peer), { expirationTtl: PEER_TTL_S });
  await appendOutbox(KV, room, peerId, { type: 'peer-join', id: peerId, name: peer.name, role }, now);

  const roster = [...peers, peer].map(publicPeer);
  return json({ peerId, role, seq: now, peers: roster, maxPeers: MAX_PEERS });
}

async function opSend(KV, room, request, now) {
  let body = {};
  try { body = await request.json(); } catch (_) {}
  const from = body.peerId;
  if (!from) return json({ error: 'no peerId' }, 400);
  if (!body.msg) return json({ error: 'no msg' }, 400);

  const peerRaw = await KV.get(kPeer(room, from));
  if (peerRaw) {
    let p; try { p = JSON.parse(peerRaw); } catch (_) { p = null; }
    if (p) { p.seen = now; await KV.put(kPeer(room, from), JSON.stringify(p), { expirationTtl: PEER_TTL_S }); }
  }
  const seq = await appendOutbox(KV, room, from, body.msg, now);
  return json({ ok: true, seq });
}

async function opPoll(KV, room, url, now) {
  const peerId = url.searchParams.get('peerId') || '';
  const after = parseInt(url.searchParams.get('after') || '0', 10) || 0;

  if (peerId) {
    const peerRaw = await KV.get(kPeer(room, peerId));
    if (peerRaw) {
      let p; try { p = JSON.parse(peerRaw); } catch (_) { p = null; }
      if (p) { p.seen = now; await KV.put(kPeer(room, peerId), JSON.stringify(p), { expirationTtl: PEER_TTL_S }); }
    }
  }

  const peers = await listPeers(KV, room, now);

  let messages = [];
  for (const p of peers) {
    const raw = await KV.get(kOutbox(room, p.id));
    if (!raw) continue;
    let list; try { list = JSON.parse(raw); } catch (_) { continue; }
    for (const m of list) if (m.seq > after) messages.push(m);
  }
  // room-level events (leaves, host migrations) -- survive peer deletion
  try {
    const evRaw = await KV.get(kEvents(room));
    if (evRaw) { const evList = JSON.parse(evRaw); for (const m of evList) if (m.seq > after) messages.push(m); }
  } catch (_) {}
  messages.sort((a, b) => a.seq - b.seq);

  const maxSeq = messages.length ? messages[messages.length - 1].seq : after;
  return json({ seq: maxSeq, peers: peers.map(publicPeer), messages });
}

async function opLeave(KV, room, request, now) {
  let body = {};
  try { body = await request.json(); } catch (_) {}
  const from = body.peerId;
  if (from) {
    await appendRoomEvent(KV, room, { type: 'peer-leave', id: from }, now);   // survives the delete below
    await KV.delete(kPeer(room, from));
    await KV.delete(kOutbox(room, from));   // clean up their message backlog too
  }
  return json({ ok: true });
}

async function opSnapshotPost(KV, room, request) {
  let body = {};
  try { body = await request.json(); } catch (_) {}
  if (!body.snapshot) return json({ error: 'no snapshot' }, 400);
  let prev = { version: 0 };
  try { const raw = await KV.get(kSnapshot(room)); if (raw) prev = JSON.parse(raw); } catch (_) {}
  const version = (prev.version || 0) + 1;
  await KV.put(kSnapshot(room), JSON.stringify({ snapshot: body.snapshot, version, from: body.peerId || null }));
  return json({ ok: true, version });
}

async function opSnapshotGet(KV, room) {
  const raw = await KV.get(kSnapshot(room));
  if (!raw) return json({ snapshot: null, version: 0 });
  let s; try { s = JSON.parse(raw); } catch (_) { return json({ snapshot: null, version: 0 }); }
  return json({ snapshot: s.snapshot, version: s.version });
}

/* ============================================================================
 * WRANGLER CONFIG — paste into wrangler.toml (replace the id with yours)
 * ----------------------------------------------------------------------------
 * name = "thunder-relay-free"
 * main = "src/index.js"
 * compatibility_date = "2024-09-01"
 *
 * [[kv_namespaces]]
 * binding = "ROOMKV"
 * id = "PASTE_THE_ID_FROM_wrangler_kv_namespace_create_HERE"
 * ==========================================================================*/

/* ============================================================================
 * CLIENT NOTE — throttle position sync on the free tier
 * ----------------------------------------------------------------------------
 * KV free = 1,000 writes/day. Each state broadcast is a write. At 10/sec one
 * player burns 1,000 writes in ~100 seconds. So on the free worker, WIDEN the
 * state-send interval. In the game, set the meta tag:
 *     <meta name="thunder-tier" content="free">
 * and raise ROOM_STATE_MS from 100 to ~1000-2000 for free-tier rooms. Co-building
 * (edits/snapshots) is naturally low-frequency and fine; it's continuous position
 * streaming that needs the brake.
 * ==========================================================================*/
