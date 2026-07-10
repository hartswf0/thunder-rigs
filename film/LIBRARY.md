# THE LIBRARY — the holy place in the software cathedral

Everything else in Thunder Rigs is weather; the LIBRARY is what remains.
Every generation — rig, actor, set, world, shot, clip, film — is KEPT the
moment it exists: pictured, named, mood-tagged, provenance-marked, placeable
again forever. Nothing the forge makes is disposable. The studio is not a
form you fill; it is a library you browse and compose FROM.

## What the mockups establish (the canon)

- ENTRIES, not fragments: every asset card = thumbnail (auto-rendered from
  the object at bake time) + name + kind tags (character/structure/prop/
  effect/set) + mood tags + IN SCENE state + favorite. The LEDGER row IS the
  library entry — same record, two views (scene = where it stands, library =
  that it exists).
- BROWSE BY MOOD (haunting/stormy/abandoned/mysterious/serene) and by kind;
  search across everything ever made; RECENTLY USED; COLLECTIONS; FAVORITES.
- + ADDS TO SCENE: tapping an entry places it at a mark (placeholder-first,
  LEDGER inv. 7) — the library is the palette, the world is the canvas.
- CLIPS: performed takes are entries too (thumbnail + duration); a film is
  composed by DRAGGING CLIPS into a reel strip — editing as arranging relics.
- THE COMPOSER reads the library: scene/setting + locale TAGS (which are
  library entries), mood/time/weather, director's notes, shot size — compose
  pulls FROM what is kept before forging anything new.
- DRAG & DROP IN: fbx/glb/obj/png/jpg become entries — outside things can be
  consecrated too.
- Storage: entries persist (localStorage index + code; thumbnails as small
  dataURLs) — the shelf survives every reload. Goldens are the library's
  founding donation, marked provenance:golden.

## Build order (with the LEDGER, next session)

1. LEDGER rows gain {thumb, tags, mood, favorite, usedAt} — auto-thumbnail
   via a one-off offscreen render at generation/bake time.
2. LIBRARY panel = the studio's second tab: search / mood chips / kind tabs /
   featured / recently used; + places at a mark.
3. Persist the index; goldens seeded as entries; films & takes filed as clips.
4. Composer reads locale tags from entries; drag-clips reel strip last.
