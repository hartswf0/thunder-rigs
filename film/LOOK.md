# THE LOOK — what bruno-simon.com does, and Thunder Rigs' native answer

Bruno's portfolio reads as a *miniature diorama you can drive*. Deconstructed,
it is ~8 techniques. He bakes his world in Blender; our world is GENERATED at
runtime — so every technique gets a procedural equivalent: **the forge bakes.**

## The gap, ranked by impact-per-effort

1. **POST STACK** (carries half the look)
   EffectComposer: Bloom (emissives glow — lanterns, neon strips, leaderboard),
   tilt-shift DoF (the miniature feel — blur top/bottom edges), vignette, and a
   color-grade (lift shadows toward the palette, crush to warm/pink/night
   looks). One-time wiring; every world benefits.

2. **THE FORGE BAKES** (his Blender lightmaps, our way)
   At generation time, WG/VG write **vertex colors**: height gradient (darker
   at base → lit at top), fake AO (darken where boxes meet the ground / inside
   clusters), sun side vs shade side tint. MeshStandard → vertexColors:true.
   Zero runtime cost; every generated fort/world/rig inherits soft depth.

3. **BEVELED PRIMITIVES**
   His edges catch light because everything is beveled. Swap raw BoxGeometry
   in VG/WG for a RoundedBox helper (few segments, small radius). Single
   change in the grammar; the whole aesthetic softens.

4. **ONE PALETTE PER WORLD** (art direction as data)
   His zones: autumn-orange / dusk-pink / neon-night — sky, fog, ground, and
   props share one ramp. We have WG.atmosphere + WORLDCERT contrast; add
   curated palette presets (5-color ramps) the composer picks from, and grade
   the post stack to match. CINEOSIS layers map naturally: past=faded ramp,
   present=saturated, future=night-neon.

5. **SOFT LIGHT + BLOB SHADOWS**
   One directional light, PCFSoft, wide shadow camera, low intensity + strong
   hemisphere. Rigs already have contactShadow — extend to bots/forts.

6. **GROUND LIFE**
   Instanced grass tufts (cones, vertex-gradient), path/shore banding, water
   with animated foam edge (his rivers are flat color + white shore ribbon —
   cheap shader). Papers/leaves as instanced quads drifting.

7. **CAR JUICE**
   Visual suspension (body spring-wobble on accel/brake/turn), wheel dust
   particles, tire marks on drift, damped camera follow with slight tilt.
   The car must feel HEAVY and TOY-LIKE at once.

8. **DIEGETIC UI** (his signage IS the world)
   Leaderboard, labels, progress bars are 3D objects in-world. We already
   believe this (drive-in screen, thundermark) — extend: film titles as
   standing signage, cast names floating at actors, the studio as a physical
   backlot zone.

## Order of construction
POST STACK → FORGE BAKES → BEVELS → PALETTES → the rest as polish passes.
First two alone move us 70% of the distance.

## The film connection
The CINEOSIS camera grammar (wide/close/aerial/low) + DoF + grading = takes
that look like his site's screenshots. `export the film` should render through
the post stack — the look IS the cinematography.
