# The Cartridge — games as data, one engine

**Format id:** `thunder-rigs.cartridge/v1` · **File:** `*.trig.json` ·
**Schema:** [`cartridge.schema.json`](cartridge.schema.json) ·
**Examples:** [`examples/`](examples/)

A cartridge is the single portable artifact of Thunder Rigs: a world, its
inhabitants, the rules of play, the interface it needs, and the film that can be
shot in it — **as one JSON document**. Striker, FLAG RUN, HIDE & SNEAK, GOLF stop
being siblings of the HTML file and become *data loaded by one engine*.

It is deliberately the same object seen from five angles:

| Angle | The cartridge is… |
|---|---|
| **Save / course library** | what you write to IndexedDB or download — a shelf of certs + thumbnails |
| **Multiplayer** | what peers exchange — the sync messages (`vcode`, `{type:'world', code}`, `{type:'fort', id, code, anchor}`) are cartridge *fragments* |
| **Generation** | what the LLM emits — prompt → cartridge → validator → runtime |
| **Command bus** | the ledger the bus mutates — every verb (`spawn`, `place`, `goal`, `powerup`) edits `entities[]` |
| **Godot export** | a scene-tree description a translator can walk (§ Godot) |

## Design laws

1. **Code is the source of truth; geometry is its local render.** Worlds, rigs
   and forts carry their *generation source* (`build(w,WG,THREE)` /
   `build(g,VG,THREE)` strings), exactly as multiplayer already ships them. The
   deterministic FORGE re-runs the code anywhere and gets identical meshes.
   Serialized primitive rows (`objects[]`) exist only for hand-placed editor
   geometry — the one thing that has no source.
2. **Nothing enters the scene without a cert.** Loading a cartridge runs the
   same admission pipeline as generation: FORGE cost cert (meshes/tris/ms/hash)
   → WORLDCERT legality (bounds, spawn clearance, drivability, contrast). A
   cartridge may *carry* its last cert (`world.cert`) for shelf display, but the
   engine never trusts it — it re-certifies on load. Reject-and-repair, always.
3. **Deterministic or declared.** Same cartridge + same engine version ⇒ same
   world on every machine. Generation code must draw randomness from the seeded
   grammar (`WG.rand(seed)`), never `Math.random()`/`Date.now()` (the sandbox
   nulls them anyway). Anything non-deterministic (bot minds) is *declared* as a
   prompt, not baked as behavior.
4. **Progressive: every block after `world` is optional.** `meta + world` is a
   **course**. Add `entities` and it's **inhabited**. Add `rules` and it's a
   **game**. Add `cine` and it's a **film set**. A partial cartridge is not a
   degenerate one — it's an earlier stage of the same object.
5. **Provenance rides along.** Every generated block keeps the human utterance
   that made it (`prompt`). The library is searchable by what people *said*,
   and re-prompting ("make it meaner") edits from the utterance, not from
   geometry.

## The document

```jsonc
{
  "format": "thunder-rigs.cartridge/v1",

  "meta": {
    "id": "bone-desert-flag-run",          // kebab-case, unique on the shelf
    "name": "BONE DESERT · FLAG RUN",
    "author": "hartswf0",
    "created": "2026-07-08T00:00:00Z",
    "engine": { "min": "1.0.0" },          // oldest engine that can run it
    "description": "Rib-cage gate, two skull mesas, three caps wins.",
    "tags": ["desert", "ctf", "2-8 players"]
  },

  "world": {
    "atmosphere": { "sky": "#b8a58c", "fog": "#8f7f68", "ground": "#2e2620" },
    "code": "function build(w, WG, THREE){ … }",   // WG source — the truth
    "objects": [ /* hand-placed editor rows, if any */ ],
    "prompt": "a bone desert with a rib-cage gate",
    "cert": {                                       // last known; re-checked on load
      "forge": { "meshes": 214, "tris": 4180, "ms": 11, "hash": "afbf748f" },
      "world": { "hash": "5a9642ff", "drivable": { "drivableFraction": 0.61,
                 "connectedFraction": 0.97 }, "violations": 0 }
    }
  },

  "entities": [
    { "kind": "vehicle", "id": "p1", "at": { "x": 0, "z": 15 },
      "rig": { "spec": { "color": 1697480, "body": 2 }, "vcode": "function build(g,VG,THREE){…}" } },
    { "kind": "bot", "id": "ossuary-warden", "at": { "x": -30, "z": -40 },
      "rig": { "spec": { "color": 16711680 } },
      "mind": { "prompt": "guard the rib gate; fortify when idle", "aggression": 0.7 } },
    { "kind": "fort", "id": "f-ribgate", "anchor": { "x": -30, "z": -40 },
      "code": "function build(w, WG, THREE){ … }" },
    { "kind": "flag", "id": "flag-blue", "team": "BLUE", "at": { "x": -60, "z": 0 } },
    { "kind": "flag", "id": "flag-red",  "team": "RED",  "at": { "x": 60,  "z": 0 } },
    { "kind": "powerup", "id": "boost-1", "at": { "x": 0, "z": -50 },
      "effect": "overdrive", "respawn": 20 }
  ],

  "rules": {
    "mode": "flag-run",                    // flag-run | golf | hide-and-sneak | overdrive | targets | free-build | custom
    "teams": 2,
    "timers": { "prep": 20, "match": 300 },
    "winCondition": { "type": "caps", "value": 3 },
    "bots": { "count": 2, "ai": true }
    // custom modes: { "mode": "custom", "code": "function mode(game, THREE){…}" }
    // — same sandbox, entry symbol `mode`, via FORGE.executeEntry.
  },

  "ui": {
    "hudSlots": { "status": "score" },     // what owns the shell's center slot
    "chips": [                              // canned command-bus utterances
      { "label": "FORTIFY", "say": "fortify the nearest flag" },
      { "label": "RESET",   "say": "reset my rig" }
    ]
  },

  "cine": {
    "shots": [                              // exactly CINE's shot record
      { "p": [40, 18, 40], "t": [0, 2, 0],  "mode": "FREE", "hold": 1.0, "travel": 2.4 },
      { "p": [-60, 6, 10], "t": [-60, 1, 0], "mode": "FREE", "hold": 1.5, "travel": 3.0,
        "subject": "flag-blue" }            // optional binding: follow/look-at an entity
    ]
  },

  "net": { "world": "latest-wins", "forts": "accumulate" }   // sync semantics (defaults shown)
}
```

## Field notes (the decisions that matter)

- **`world.code` vs `world.objects`** — both may coexist: `code` regenerates the
  generated place; `objects` layers the hand-edits on top (the current
  `DRIVABLE FORTS` save rows: `{id, type, dims{l,h,w}, def{c,ec}, pos[3],
  rot[4] quaternion, scale[3], anim*}`). Load order: atmosphere → code →
  objects → entities. This is exactly today's runtime order.
- **`entities[].kind` is closed but extensible by version.** v1 kinds:
  `vehicle · bot · fort · powerup · goal · target · ball · flag`. The command
  bus validates its verbs against this list, and every placement is checked
  against WORLDCERT's spawn-clear cylinders.
- **`rules.mode: "custom"`** reuses the harness's entry generalization: the
  cartridge ships `function mode(game, THREE){…}`, executed in the same
  SHADOWED sandbox with the same budget discipline. A game mode is just one
  more thing the forge admits.
- **`cine.shots`** is byte-compatible with today's `CINE.serialize()` (`{p, t,
  mode, hold, travel}`), extended with an optional `subject` entity binding.
  Playback is the existing Catmull-Rom drive; export is the Operator Studio
  path.
- **`net`** is informative, not normative: worlds sync latest-wins, forts
  accumulate — the engine's existing semantics. It's recorded so a future
  engine can change defaults without ambiguity about old cartridges.
- **Budgets are schema-enforced**: `vcode ≤ 20 000` chars (the transmit
  ceiling), world `code ≤ 32 000`, `cine.shots ≤ 24`, `entities ≤ 64`. The
  schema rejects what the relay or forge would reject — fail at the shelf, not
  in the room.

## Loading = the admission pipeline

```
cartridge.json
  → schema validate            (this file's contract)
  → FORGE.compile(world.code)  (cost cert: meshes/tris/ms/hash)
  → CERTIFY.certify(root)      (legality: bounds/spawn/drivable/contrast)
  → applyRepairs / reprompt    (mechanical fixes silent; topology → model)
  → entities placed            (each checked against spawn-clear)
  → rules.mode installed       (registry mode, or sandboxed custom code)
  → ui.chips registered        (command-bus utterances)
  → shelf entry written        (cert + thumbnail + provenance)
```

A cartridge that fails admission is never half-loaded: it stays on the shelf
with its violation list, the same way a failed generation shows its forge
diagnostics.

## Godot bridge (the translator, not a rewrite)

| Cartridge | Godot |
|---|---|
| `world.code` → forge output | glTF import → `StaticBody3D` terrain + `MeshInstance3D`s |
| `world.atmosphere` | `WorldEnvironment` (sky, fog color/density) |
| `entities[]` | one `PackedScene` per `kind`, instanced at `at` |
| `entities[].rig.vcode` → forge output | glTF per rig; `spec` → material overrides |
| `rules` | a `GameMode` `Resource`; `custom.code` ports by hand (declared, never silent) |
| `ui.chips` | a `Control` scene of buttons emitting the same bus verbs |
| `cine.shots` | `Path3D` (Catmull-Rom through `p[]`) + `Camera3D` follow, `t[]` as look-target track |
| `meta` + certs | export manifest; a Godot build refuses an uncertified cartridge too |

The export walks the document; nothing in the engine needs to know Godot
exists.

## What this unlocks, in order

1. **Saves & the shelf** — `serialize()`/`load()` against this schema; a course
   library is a directory of `.trig.json` + thumbnails.
2. **"A prompt that turns anything into a game"** — the LLM's output contract
   becomes *this document* (schema in the prompt, validator on the reply — the
   same discipline as `build()` code, one level up).
3. **The command bus** — verbs are cartridge edits; chips are canned utterances;
   bots get minds because `mind.prompt` is already a field.
4. **CINE production** — a shot list that travels with the world it was framed
   in.
5. **Godot** — the table above.
