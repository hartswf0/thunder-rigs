# THE FILM LEDGER — tracking every entity with respect

The named disease: **nothing links what is generated, what is performed, what
the camera looks at, what is drivable, and what is directable.** An actor is a
prompt in a blueprint, a mesh in the scene, maybe a physics entry, maybe a shot
subject — four fragments, no spine. So PERFORM rebuilt over generated work,
actors stacked, budgets blew silently, and the camera framed nothing in
particular. Fragments cannot be respected; only entities can.

## The ledger: one row per film entity, cradle to grave

```js
LEDGER[id] = {
  id, kind,                    // cast | set | shot-stage | world
  prompt,                      // the words that made it (editable, the source)
  code,                        // the forged build() — the truth
  provenance,                  // 'model' | 'golden' | 'hand'  (never lied about)
  object,                      // the live THREE object (null = not built)
  placement: {x, z, ry},       // WHERE — survives regeneration
  physics: 'solid'|'visual',   // drivability: is it in physicsMeshes? certified?
  cert,                        // its WORLDCERT/forge cert (meshes, budget, legality)
  shots: [i, ...],             // every shot that frames it (two-way with beats)
  verbs: ['patrol','orbit',…], // how it can be DIRECTED (bus-bound, per entity)
  state: 'planned'|'generating'|'built'|'placed'|'performing'
}
```

## Invariants (what "respectfully" means, enforced)

1. **Nothing in the film exists outside the ledger.** GEN writes a row before
   forging; the scene graph renders FROM the ledger (not from ad-hoc scans);
   CAMVIZ and PERFORM read the same rows.
2. **Placement is sovereign.** The player's drag/rotate updates the row;
   regeneration rebuilds AT the row's placement; PERFORM never moves what the
   player placed.
3. **Shots and subjects are two-way.** A shot knows its subject entities; an
   entity lists its shots. Framing resolves from the ledger's live object —
   the camera always looks at something real, at its real size (frustum-fit).
4. **Drivability is a tracked property, not luck.** Every built entity passes
   WORLDCERT (bounds/spawn/collision); its row says solid or visual; budget
   sums are ledger-computed BEFORE forging (refuse early, not blow up late).
5. **Directability is per-entity verbs.** "the dragon patrols" resolves through
   the ledger (entity → object → motion), not string-matching scene names.
6. **PERFORM = the ledger performing.** Beats reference entity ids; a beat
   whose entity is built USES it (never rebuilds); missing entities generate
   first or are skipped loudly.

## Build order (next session, first thing)

1. `window.LEDGER` + migrate `__castActors`/`__filmBuilt`/motif-fort ids into
   rows; GEN/STAGE write rows; blueprint beats carry entity ids.
2. Scene graph renders from the ledger (state chips = row.state; counts real).
3. PERFORM resolves beats via ledger (kept/built/skip-loud); camera via
   row.object frustum-fit.
4. Budget pre-check: sum row cert.meshes + request ≤ global budget before
   forging.
5. Directability: motion verbs take entity ids; verbs listed on the row,
   shown in the graph.

## Field reports driving the build (2026-07-10, western film session)

7. **PLACEHOLDERS FIRST.** Composing creates a visible placeholder (ghost
   box + name tag) at every entity's mark IMMEDIATELY — placement exists
   before generation. GEN replaces the placeholder IN PLACE. This also ends
   the observed bug where generating one character deleted others: every
   entity owns its slot from t=0; generation may only ever swap the object
   inside a row, never touch another row's object.
8. **EVERY GENERATION IS A HELLO SUBJECT.** Any generated actor/set opens in
   the HELLO/WORLD ritual for part-level editing (tap parts, move/rotate/
   scale, say-a-change) — and the edit writes BACK to the row's code.
9. **BLOCKING (the missing planning step).** Shots need marks: each shot row
   gains actor marks {entityId → x,z,facing}; PERFORM tweens actors to their
   marks before the camera cuts (theatre blocking), integrated with CINE's
   existing shot drive — beat = (move to marks) + (camera) + (action verbs).
10. **POSSESSION.** Click any cast actor → DRIVE IT (player physics binds to
    that body; your rig parks). Click-to-possess, click-away to release.
