# ABC CINEOSIS → THUNDER-FILM

**The film language, compiled to a world.** ABC CINEOSIS composes films as
temporal machines (perception, action, affection, sound, memory, time). Its
BEFLIX-128 target renders them as dot-matrix frames. **THUNDER-FILM is the
second render target**: the same blueprint compiles to *actual camera moves,
cast, geometry, and sound cues* inside Thunder Rigs — and exports as a real
video take.

```
film_seed ──(CINEOSIS composer: model or golden poet)──► blueprint JSON
blueprint ──(TWIN.compileFilm)──► thunder-twin beats
beats ─────(performTwin clock)──► spoken direction on the BUS
                                   · cast a keeper named vess      (HELLO)
                                   · camera close on vess          (camera move)
                                   · mark a wide shot on vess      (reel)
                                   · fort beats                    (motif geometry)
                                   · cue beats                     (sound design)
"export the film" ───────────────► <scene>-takeN.webm
```

The key integration move: **compiled beats speak the studio grammar.** Camera
direction, shot marking, casting, and motion are already bus verbs — so the
compiler's output is mostly *utterances scheduled on a clock*. Direction is
literally spoken.

## The blueprint (`cineosis-film/v1`)

The composer (model, or the deterministic golden poet) emits JSON, not prose:

```jsonc
{
  "format": "cineosis-film/v1",
  "title": "THE GATE THAT REMEMBERS RAIN",
  "seed": "a keeper of the storm gate",
  "engine": "the gate's past floods every present crossing",   // temporal engine
  "abc": {
    "a": "the keeper — pressure of guarding what already fell",  // Actor/Affect
    "b": "gate beams, rain voxels, a circling rig",              // Body/Behavior
    "c": "the drive-in screen replays the flood inside the scene" // Continuity/Crystal
  },
  "motifs": [
    { "name": "the gate", "past": "a broken arch", "present": "a lit arch", "future": "an arch of wireframe rain" }
  ],
  "cast": [ { "name": "vess", "desc": "a storm-keeper rig with lantern strips" } ],
  "beats": [
    { "title": "What the gate sees", "dur": 8, "layer": "past",
      "fn": "perception", "subject": "vess",
      "action": "vess patrols the gate slowly",
      "sound": "low hum, rising",
      "transition": "dissolve" }
    // 8–14 beats, each: fn ∈ the seven image types, layer ∈ past|present|future
  ]
}
```

## The compilation grammar

**Image function → camera** (each `fn` has a camera meaning; the compiler emits
`camera …` and `mark a … shot …` utterances):

| fn | camera | travel/hold |
|---|---|---|
| `perception` | `wide` on subject | slow travel, long hold — the world as seen |
| `action` | `behind` (tracking) | fast travel — bodies in relation |
| `affection` | `close` on subject | slow, near — pressure in a face/surface |
| `opsign` | `aerial`, locked | no motion, longest hold — seeing is the event |
| `sonsign` | `low`, held | the cue carries the beat (see sound) |
| `crystal` | `wide` **on the drive-in screen** | past inside present — the film-in-the-film |
| `recollection` | repeat of an earlier beat's frame | the memory contaminates the present |

**Temporal layer → material state** (what geometry a beat may erect):

| layer | material |
|---|---|
| `past` | **sculpture** — light residue, drive-through (the drawing of what was) |
| `present` | **native fort** — solid, collidable (what is, has consequence) |
| `future` | say-verbs — powerups/targets (what may arrive: affordances, not walls) |

**Motifs → evolving geometry**: a motif compiles to fort beats at one anchor —
its `past` form early, `present` form mid-film, `future` form late. The same
place transforms; the viewer tracks time through it.

**`action` → spoken direction**: the beat's visible action is emitted verbatim
onto the bus (`vess patrols the gate slowly` → the motion verb moves the cast).

**`sound` → cue beats**: a small lexicon maps sound words to the SFX engine —
rise/rumble→`rise`, impact/strike/thunder→`impact`, chime/resolve→`complete`,
collapse→`demolish`, hush/silence→(build-drone off). Silence is a cue too.

**`transition` → cut style**: `cut` = travel 0.1 (a jump), `dissolve` = slow
travel, `match` = same subject new angle, `hold` = no camera change.

**Cast → HELLOs**: every named subject is cast at t=0 (`cast a … named vess`),
so later beats can frame and direct them.

**Edit logic → the reel**: every beat that changes the frame also `mark`s a
shot — by the film's end the CINE reel *is* the edit, and `export the film`
records the take.

## Determinism ladder (same as everything in this engine)

1. **Golden poet** (no model): a seed compiles to a well-formed 9-beat
   blueprint cycling the seven functions across past→present→future.
2. **Model composer**: the CINEOSIS contract (compact) asks for blueprint
   JSON; shape-validated; the golden poet is the few-shot and the floor.
3. Beat-level floors: fort/rig code golden-baked; unknown utterances fall
   through the bus's help.

## Speak it

```
compose a film about a keeper of the storm gate   ← blueprint → beats → rolling
export the film                                    ← the take saves itself
save the twin                                      ← the film as a .twin.json
```
