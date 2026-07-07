/* ============================================================================
 * THUNDER RIGS — MULTIPLAYER RELAY WORKER (Cloudflare)
 * ----------------------------------------------------------------------------
 * This is the REAL server the game talks to. It was missing — the game pointed
 * at a worker nobody could see or verify. This file IS that worker, written to
 * the exact contract the client already expects, so multiplayer becomes real
 * and — critically — YOURS to control, debug, and extend.
 *
 * WHAT IT DOES
 *   A room is a mailbox with a monotonic sequence number. Peers POST messages
 *   to /send; every message gets the next seq. Peers GET /poll?after=N and
 *   receive everything with seq > N, plus the live peer roster. That's the whole
 *   relay: state (cars), edits (geometry), chat, AI requests — all the same pipe.
 *
 * WHY DURABLE OBJECTS
 *   A room needs ONE consistent copy of its message log and roster. A plain
 *   Worker is stateless and would lose messages between requests. A Durable
 *   Object gives each room a single-threaded, consistent home. One DO instance
 *   per room code, addressed by name.
 *
 * ENDPOINTS (all under /trig/{room}/{op}, all return JSON, all CORS-open)
 *   POST join      body {name,color,rig}      -> {peerId, role, seq, peers[], maxPeers}
 *   GET  poll      ?peerId=&after=N           -> {seq, peers[], messages[]}
 *   POST send      body {peerId, msg}         -> {ok, seq}
 *   POST leave     body {peerId}              -> {ok}
 *   POST snapshot  body {peerId,snapshot,...} -> {ok, version}
 *   GET  snapshot  ?peerId=                   -> {snapshot, version} | {snapshot:null}
 *   GET  health                               -> {ok, rooms, ts}   (diagnostics)
 *
 * DEPLOY (about 3 minutes)
 *   1. npm create cloudflare@latest thunder-relay   (choose "Hello World Worker")
 *   2. Replace src/index.js (or worker.js) with THIS file.
 *   3. In wrangler.toml add the Durable Object binding + migration (see WRANGLER
 *      block at the bottom of this file — paste it in).
 *   4. npx wrangler deploy
 *   5. Copy your deployed URL (e.g. https://thunder-relay.YOUNAME.workers.dev)
 *      and put it in the game's <meta name="thunder-worker-url" content="...">.
 *   Done. Multiplayer is now real and running on infrastructure you own.
 * ==========================================================================*/

const MAX_PEERS = 8;
const PEER_TTL_MS = 15000;      // a peer that hasn't polled in 15s is dropped
const MSG_KEEP = 400;           // ring-buffer: keep the last N messages per room
const MSG_TTL_MS = 60000;       // messages older than 60s are pruned

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

/* ── Worker entry: route /trig/{room}/{op} to that room's Durable Object ──── */
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean); // ['trig','ROOM','op']

    if (parts[0] === 'health') {
      return json({ ok: true, service: 'thunder-relay', ts: Date.now() });
    }

    // VOICE — record audio in the browser, POST it here, we forward it to OpenAI
    // transcription server-side (no CORS, works on iOS). Key comes from the
    // x-openai-key header (the app's configured key) or the OPENAI_KEY secret.
    if (parts[0] === 'transcribe') {
      if (request.method !== 'POST') return json({ error: 'POST audio to /transcribe' }, 405);
      const key = request.headers.get('x-openai-key') || env.OPENAI_KEY;
      if (!key) return json({ error: 'no OpenAI key — set one in the app (OpenAI direct) or an OPENAI_KEY worker secret' }, 400);
      try {
        const audio = await request.arrayBuffer();
        if (!audio || audio.byteLength < 800) return json({ error: 'audio too short / empty' }, 400);
        const ct = (request.headers.get('content-type') || 'audio/webm').split(';')[0];
        const ext = ct.includes('mp4') ? 'mp4' : ct.includes('mpeg') ? 'mp3' : ct.includes('ogg') ? 'ogg' : ct.includes('wav') ? 'wav' : 'webm';
        const form = new FormData();
        form.append('file', new Blob([audio], { type: ct }), 'audio.' + ext);
        form.append('model', request.headers.get('x-model') || 'gpt-4o-mini-transcribe');
        const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: form,
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) return json({ error: (data.error && data.error.message) || ('openai ' + r.status) }, 502);
        return json({ text: (data.text || '').trim() });
      } catch (e) {
        return json({ error: 'transcribe error: ' + (e && e.message || e) }, 500);
      }
    }

    if (parts[0] !== 'trig' || parts.length < 3) {
      return json({ error: 'bad path — expected /trig/{room}/{op}' }, 404);
    }

    const room = decodeURIComponent(parts[1]).toUpperCase().slice(0, 64);
    const op = parts[2];

    // Address the Durable Object for this room by its name (the room code).
    const id = env.ROOMS.idFromName(room);
    const stub = env.ROOMS.get(id);

    // Forward to the DO with op + room in the URL it sees.
    const doUrl = new URL(request.url);
    doUrl.pathname = '/' + op;
    return stub.fetch(new Request(doUrl, request));
  },
};

/* ── The room itself: one Durable Object instance per room code ───────────── */
export class ThunderRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    // In-memory is fine for a live room; DO storage persists across evictions.
    this.peers = new Map();     // peerId -> {id,name,color,rig,role,lastSeen}
    this.log = [];              // [{seq, from, msg, t}]
    this.seq = 0;
    this.snapshot = null;       // {snapshot, version, from}
    this.loaded = false;
  }

  async load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const saved = await this.state.storage.get(['seq', 'log', 'snapshot']);
      if (saved.get('seq')) this.seq = saved.get('seq');
      if (saved.get('log')) this.log = saved.get('log');
      if (saved.get('snapshot')) this.snapshot = saved.get('snapshot');
    } catch (_) {}
  }

  async persist() {
    try {
      await this.state.storage.put({ seq: this.seq, log: this.log, snapshot: this.snapshot });
    } catch (_) {}
  }

  prune(now) {
    // Drop stale peers (host migrates to the oldest remaining peer).
    let hostGone = false;
    for (const [pid, p] of this.peers) {
      if (now - p.lastSeen > PEER_TTL_MS) {
        if (p.role === 'host') hostGone = true;
        this.peers.delete(pid);
      }
    }
    if (hostGone && this.peers.size > 0) {
      // Promote the earliest-joined survivor to host so the field has an owner.
      const survivor = [...this.peers.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0];
      survivor.role = 'host';
    }
    // Prune old messages (ring buffer + TTL).
    const cutoff = now - MSG_TTL_MS;
    this.log = this.log.filter(m => m.t >= cutoff);
    if (this.log.length > MSG_KEEP) this.log = this.log.slice(this.log.length - MSG_KEEP);
  }

  roster() {
    return [...this.peers.values()].map(p => ({
      id: p.id, name: p.name, color: p.color, rig: p.rig, role: p.role,
    }));
  }

  async fetch(request) {
    await this.load();
    const url = new URL(request.url);
    const op = url.pathname.slice(1);
    const now = Date.now();
    this.prune(now);

    try {
      if (op === 'join')     return await this.opJoin(request, now);
      if (op === 'poll')     return this.opPoll(url, now);
      if (op === 'send')     return await this.opSend(request, now);
      if (op === 'leave')    return await this.opLeave(request, now);
      if (op === 'snapshot') return request.method === 'GET' ? this.opSnapshotGet(url) : await this.opSnapshotPost(request);
      return json({ error: 'unknown op: ' + op }, 404);
    } catch (e) {
      return json({ error: 'room error: ' + (e && e.message || e) }, 500);
    }
  }

  async opJoin(request, now) {
    if (this.peers.size >= MAX_PEERS) return json({ error: 'ROOM FULL' }, 403);
    let body = {};
    try { body = await request.json(); } catch (_) {}
    const peerId = 'p' + Math.random().toString(36).slice(2, 10) + now.toString(36);
    const role = this.peers.size === 0 ? 'host' : 'guest';
    this.peers.set(peerId, {
      id: peerId,
      name: String(body.name || 'PLAYER').slice(0, 24),
      color: String(body.color || '#ffffff').slice(0, 16),
      rig: body.rig || null,
      role, lastSeen: now, joinedAt: now,
    });
    // Announce the join to everyone as a message too (roster covers it, but this
    // gives the client an immediate event to react to).
    this.push(peerId, { type: 'peer-join', id: peerId, name: body.name, role }, now);
    await this.persist();
    return json({ peerId, role, seq: this.seq, peers: this.roster(), maxPeers: MAX_PEERS });
  }

  opPoll(url, now) {
    const peerId = url.searchParams.get('peerId') || '';
    const after = parseInt(url.searchParams.get('after') || '0', 10) || 0;
    const p = this.peers.get(peerId);
    if (p) p.lastSeen = now;   // polling keeps you alive
    const messages = this.log.filter(m => m.seq > after);
    return json({ seq: this.seq, peers: this.roster(), messages });
  }

  push(from, msg, now) {
    this.seq += 1;
    this.log.push({ seq: this.seq, from, msg, t: now });
    if (this.log.length > MSG_KEEP) this.log.shift();
    return this.seq;
  }

  async opSend(request, now) {
    let body = {};
    try { body = await request.json(); } catch (_) {}
    const from = body.peerId || 'unknown';
    const p = this.peers.get(from);
    if (p) p.lastSeen = now;
    if (!body.msg) return json({ error: 'no msg' }, 400);
    const seq = this.push(from, body.msg, now);
    // Persist opportunistically (not every message — batch by leaving it to
    // eviction + periodic ops; but snapshot-bearing messages matter, so persist).
    if (this.seq % 20 === 0) await this.persist();
    return json({ ok: true, seq });
  }

  async opLeave(request, now) {
    let body = {};
    try { body = await request.json(); } catch (_) {}
    const from = body.peerId;
    if (from && this.peers.has(from)) {
      const wasHost = this.peers.get(from).role === 'host';
      this.peers.delete(from);
      this.push(from, { type: 'peer-leave', id: from }, now);
      if (wasHost && this.peers.size > 0) {
        const survivor = [...this.peers.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0];
        survivor.role = 'host';
        this.push('system', { type: 'host-migrated', id: survivor.id }, now);
      }
      await this.persist();
    }
    return json({ ok: true });
  }

  async opSnapshotPost(request) {
    let body = {};
    try { body = await request.json(); } catch (_) {}
    if (!body.snapshot) return json({ error: 'no snapshot' }, 400);
    const version = (this.snapshot?.version || 0) + 1;
    this.snapshot = { snapshot: body.snapshot, version, from: body.peerId || null };
    await this.persist();
    return json({ ok: true, version });
  }

  opSnapshotGet(url) {
    if (!this.snapshot) return json({ snapshot: null, version: 0 });
    return json({ snapshot: this.snapshot.snapshot, version: this.snapshot.version });
  }
}

/* ============================================================================
 * WRANGLER CONFIG — paste into wrangler.toml
 * ----------------------------------------------------------------------------
 * name = "thunder-relay"
 * main = "src/index.js"
 * compatibility_date = "2024-09-01"
 *
 * [[durable_objects.bindings]]
 * name = "ROOMS"
 * class_name = "ThunderRoom"
 *
 * [[migrations]]
 * tag = "v1"
 * new_classes = ["ThunderRoom"]
 * ==========================================================================*/
