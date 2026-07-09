# Thunder Rigs — Harness, Context & Prompt Engineering

Thunder Rigs turns plain language into **playable 3D** — vehicles ("rigs"), whole
drivable worlds, and structures ("forts") — by having an LLM **write small
JavaScript programs** that a safe harness executes into Three.js geometry. You
type *"a dragon gate on a bone mesa"*; the model returns a `function build(...)`;
the harness runs it, certifies it, and it drops into the scene as solid,
collidable, drivable geometry.

Three disciplines make that reliable, plus a fourth that reuses them for
multiplayer:

1. **Harness engineering** — the sandbox + repair pipeline that turns
   *"usually-valid model output"* into *"always runs or degrades gracefully."*
2. **Context engineering** — the **grammars** and exemplars that shape what the
   model is even able to say, so anything it writes is safe and physical.
3. **Prompt engineering** — the strict **output contracts** that make a reply
   directly executable.
4. **Code as the wire format** — the same generated code becomes the multiplayer
   sync payload, because the harness is deterministic.

Everything below is in the single-file app (`index.html`); symbol names are given
so you can jump to them.

---

## 1. Harness engineering — the FORGE

The core bet: **the model returns CODE, not data.** A grammar of primitives is
far too small to express "a rib-cage gate"; a JSON schema of `{shape, x, y}` rows
loses craft. So the model writes a real (tiny) program, and a harness — the
**FORGE** (`window.FORGE`) — makes running untrusted code safe and predictable.

**Pipeline** (`FORGE.compile(reply, ctx)` → `execute()`):

```
sanitize → [repair strategies] → execute (sandbox) → certify → diagnostics
```

- **Sanitize** — strip markdown fences / BOM / zero-width chars; prefer fenced
  contents if present.
- **Repair strategies**, tried in order until one runs: `whole` (use the reply
  as-is), `fn-slice` (extract just the `build` function if the model wrapped it
  in prose), `assign` (handle `const build = () => …` forms). Each is a different
  way to salvage a differently-malformed reply.
- **Execute — the sandbox.** The code runs inside
  `new Function('g','VG','THREE','Math', ...SHADOWED, ...vgKeys, '"use strict";\n' + code + …)`.
  Two safety properties:
  - **`SHADOWED` globals are passed as `undefined`** — `window`, `document`,
    `localStorage`, `fetch`, `XMLHttpRequest`, `WebSocket`, `indexedDB`,
    `globalThis`, … The generated program **cannot touch the page, network, or
    storage.** It gets only `g`/`w` (a `THREE.Group` to fill), the grammar
    (`VG`/`WG`), a `THREE` handle, and `Math`.
  - **Grammar helpers are injected as named parameters** (`...vgKeys`), so code
    that *calls* a helper it forgot to *destructure* (`headlight(...)` without
    `const { headlight } = VG`) still resolves instead of throwing. This tolerates
    the single most common model slip.
- **Certify** — reject zero-mesh output; enforce a **mesh budget** (~220 for
  rigs, ~500 for worlds); snap to the floor (*"THE FLOOR IS LAW: no rig sinks, no
  rig floats"* — a bounding-box lift); stamp a content **hash** (`fnv1a`) used
  later for dedup/versioning.
- **Diagnostics** — on total failure the harness returns structured signal:
  brace/paren balance, `truncated?`, `head`/`tail` slices, char count. This isn't
  for humans — it feeds a **repair prompt** back to the model.

**Entry generalization** (`executeEntry`): the entry symbol is a *parameter*, not
a constant — `build` makes rigs and worlds, `mode` makes game loops. One sandbox,
one budget discipline, many generators.

**Deterministic floor.** If the model fails twice, the harness serves the
**nearest golden** (see §2) — the user never gets a blank. And **FORGE THEATER**
plays a diegetic build animation during the call, so latency reads as
"the machine is forging," not "it's stuck."

**The admission layer — WorldCert** (`CERTIFY`, mirrored headless-testable in
[`cert/certify.js`](cert/certify.js)). The forge cert measures *cost*
(meshes/tris/ms); a second gate measures **legality** after build, before commit:

- **bounds** — full-AABB test against the arena (`WGKIT` already demotes solids
  whose *center* leaves the map, but a bridge with an in-bounds center and a
  90-unit body escaping the rim only an extent check catches) → `clamp`/`cull`;
- **spawnClear** — a reserved cylinder around every spawn; blockers are
  physically `offset` out of it, never built on top of the car;
- **drivable** — raycast height grid → slope/corridor/flood-fill connectivity
  stats; failures are *not* mechanically fixable → `reprompt` hints;
- **contrast** — luminance gap between fog/ground/materials → `recolor`/`refog`
  toward the doctrine palette.

Every violation carries a **repair verdict** (`clamp | cull | offset |
relocateSpawn | recolor | refog | reprompt`): mechanical ones are applied
silently at commit; only topology problems go back to the model as
`promptFeedback`. Reject-and-repair beats render-and-hope — the judge pattern
applied to geometry.

The payoff: arbitrary, expressive geometry from language, with the blast radius
of a pure function.

---

## 2. Context engineering — the grammar *is* the world model

The model never sees raw Three.js. It writes against a **curated grammar** that
is simultaneously its vocabulary, its safety boundary, and its physics engine.

- **VG (Vehicle Grammar)** — `box / cyl / cone / sphere / wheels / figure`,
  materials (`paint / matte / metalMat / goldMat / emiss / glass`), plus rig
  atoms like `headlight`. (`makeVG` + the `VG` assembly.)
- **WG (World Grammar)** — materials (`flat / lit`), shapes, **MOLECULES**
  (fast composite structures: `mesa, pillar, tree, arch, bridge, ruin,
  pylonRing, torchRow, banner…`), and **SURFACES** the car can climb
  (`ramp, bank, crest, quarterPipe, mound, ridge, deck`). `WG.solid(...)` /
  `WG.surface(...)` register a mesh as collidable; `WG.atmosphere(...)` sets
  sky/fog/ground; `WG.thesis(...)` declares the landform first. (`WGKIT.makeWG`.)

Two design consequences make this *context engineering*, not just an API:

- **The vocabulary is injected into every prompt** (`VG_VOCAB` / `WG_VOCAB`).
  The model's entire surface area is a hand-picked set of verbs that are *safe by
  construction* (no I/O) and *physical by construction* (solids collide, surfaces
  are drivable). You cannot prompt-inject your way to `fetch` because `fetch`
  isn't in the world.
- **Golden libraries** (`GOLDEN`, `GOLDEN_WORLDS`, `GOLDEN_DRAFTS`) — hand-authored
  reference builds used **two ways**: (a) as the **few-shot EXAMPLE** in the
  prompt — *"Imitate the EXAMPLE's FORMAT, density and craft — never its
  subject"* — and (b) as the **deterministic fallback** when generation fails.
  One asset does double duty: it raises the ceiling (craft to imitate) and the
  floor (something good to serve on failure).

**Domain constraints are also context.** The world prompt teaches the *physics of
the place*, not just the API: keep a ~14-unit open **spawn circle** at the origin;
**atmosphere first** (dark base tones so emissive accents glow); **everything is
solid**, so compose *driving lanes* (a city is a grid with street gaps; a temple
is rings of pillars); never stack two flat surfaces within 0.3 (z-fighting). The
model isn't just told *how to draw* — it's told *how the world must behave*.

**Two representations, chosen per need.** There's a lighter path,
`aiDesignWorld`, that asks for a **JSON spec** (`{sky, fog, ground, structures:[…]}`)
— constrained, trivially validated, safe. And the **code** path (`aiForgeWorld`)
for arbitrary, high-craft geometry. Spec where safety/validation dominates; code
where expressiveness does. **Reference images** condition either — *"evoke its
palette, mood, and structures."*

---

## 3. Prompt engineering — making replies executable

Because the reply is **run**, the contracts are strict and unusually mechanical:

```
OUTPUT CONTRACT — reply with ONLY one JavaScript function, no markdown fences, no prose:
function build(w, WG, THREE){ ... return w; }

HARD FORMAT RULES — violating any makes the reply unusable:
- The FIRST characters are exactly: function build(w, WG, THREE){
  · the LAST is its matching closing brace · nothing before or after.
- NEVER rename build. Exactly ONE top-level function (helpers live INSIDE it).
- Braces and parens must balance — count them before you finish.
- Imitate the EXAMPLE's FORMAT, density and craft — never its subject.
```

Techniques at work:

- **Executable-output contract** — first/last character constraints, single named
  function, balanced brackets. These map 1:1 onto the harness's `sanitize` +
  strategies, so a compliant reply lands in the `whole` strategy on the first try.
- **Role framing** sets the craft bar and domain: *"master environment artist for
  THUNDER RIGS,"* *"WORLD ARCHITECT for a neon driving game."*
- **Format vs. subject** — the golden example teaches structure and density; the
  model must **invent the subject** and *"commit hard to the theme."* This gets
  variety without the model drifting into invalid or low-effort output.
- **Budgets in the prompt** mirror the harness's certifier (structure counts,
  mesh ceilings), so the model targets what will actually pass certification.
- **The repair loop** closes the gap between *usually valid* and *always runs*:
  the harness's structured diagnostics become a targeted repair prompt; on the
  second failure the golden fallback fires. Generation is a **loop with a
  guaranteed floor**, not a single shot.

---

## 4. Code as the wire format — the harness *is* the netcode

Multiplayer is where the harness pays a second dividend. You can't ship a
500-mesh world (or a co-builder's fort) over a relay on every edit — and the
naive `{type, dims}` arena serialization **can't even represent generated
geometry** (custom organic shapes have no primitive `type`/`dims`; they serialize
as `null` and rebuild as broken boxes).

So Thunder Rigs ships the **generation code** and re-runs the **same FORGE** on
every peer → **byte-identical geometry, deterministically**:

| Content | Payload | Model |
|---|---|---|
| **Rigs** (per player) | `vcode` in the state packet | one each |
| **Worlds** (shared) | `{type:'world', code, hash}` → `__applyForgeWorld` | latest-wins |
| **Forts** (shared) | `{type:'fort', id, code, anchor}` → `__applyForgeFort` | accumulate |

This only works because the harness is **deterministic and safe**: same code +
same grammar + same `THREE` = the same certified geometry on every machine. The
FORGE is simultaneously the *creation tool* and the *replication protocol* — the
generated program is the source of truth, and geometry is just its local render.

(Transport is deliberately boring so it survives static hosting: the client is
served by GitHub Pages and talks to a Cloudflare Worker relay over plain HTTP
polling — `/trig/{room}/{join,poll,send,leave,snapshot}` — with no game server to
run. See [README.md](README.md).)

---

## Where to look in the code

| Concern | Symbols |
|---|---|
| FORGE pipeline | `FORGE.compile` / `execute` / `executeEntry` / `sanitize` / `jsScan` |
| Sandbox | the `SHADOWED` array; the `new Function(...)` in `execute` |
| Grammars | `makeVG` / `VG`; `WGKIT.makeWG`; `VG_VOCAB` / `WG_VOCAB` |
| Prompts | `aiForgeWorld`, `aiDesignWorld`, `aiForgeDraft` system strings; the rig composer |
| Golden libraries | `GOLDEN`, `GOLDEN_WORLDS`, `GOLDEN_DRAFTS` |
| Code-as-truth sync | `broadcastWorldCode`/`applyRemoteWorld`, `broadcastFort`/`applyRemoteFort`, `__applyForgeWorld`/`__applyForgeFort`, `buildVehicleFromCode` |
| Build spectacle | `THEATER` (FORGE THEATER) |

---

*Design in one line: **let the model write a small, safe program; make the harness
that runs it deterministic; then reuse that determinism as the multiplayer
protocol.***
