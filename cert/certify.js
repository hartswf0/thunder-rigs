// ============================================================
// CERTIFY — WorldCert admission layer for Thunder Rigs forge
// Runs AFTER build(w, WG, THREE), BEFORE commit to render.
// Pure THREE math: works in browser and headless Node.
//
//   import { certify, applyRepairs, DEFAULTS } from './certify.js';
//   const report = certify(worldRoot, THREE, { arena, spawns, atmosphere });
//   if (!report.ok) {
//     applyRepairs(report, THREE);            // mechanical fixes
//     // or: send report.violations back to the model for one repair pass
//   }
//
// Verdict model: every check emits violations with a `repair` field:
//   clamp | cull | offset | relocateSpawn | recolor | refog | reprompt
// Mechanical repairs (clamp/offset/recolor/refog/cull) are applied by
// applyRepairs(). `reprompt` violations (drivability/topology) need the
// model — feed report.promptFeedback back into the forge.
// ============================================================

export const DEFAULTS = {
  arena: { halfX: 85, halfZ: 85, minY: -2, maxY: 60 },   // 170x170 base
  boundsEpsilon: 0.25,        // tolerated overhang before violation
  spawnRadius: 4.5,           // reserved cylinder around each spawn (m)
  spawnHeight: 6,
  grid: 2.0,                  // drivability sample cell size (m)
  maxSlopeDeg: 34,            // steeper than this = not drivable
  trackWidth: 3.2,            // vehicle width + margin for corridor test
  stepHeight: 0.9,            // climbable ledge height between cells
  minDrivableFraction: 0.30,  // of arena cells that must be drivable
  minConnectedFraction: 0.85, // of drivable cells reachable from spawn
  minLuminanceGap: 0.14,      // fog vs ground / fog vs object materials
  minFogFar: 1.15,            // fog.far >= arenaDiagonal * this
  doctrine: {                 // studio palette anchors for auto-contrast
    darkGround: 0x2a3438, lightSky: 0xb8c4c9,
    accents: [0x19e6c8, 0xffd23f, 0xff2e2e, 0x3b82f6],
  },
};

// ---------- small utils ----------
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const deg2tan = d => Math.tan((d * Math.PI) / 180);

function luminance(hex) {
  const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
  const lin = c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function toHexNum(c) {
  if (typeof c === 'number') return c;
  if (typeof c === 'string') return parseInt(c.replace('#', ''), 16);
  if (c && c.getHex) return c.getHex();
  return 0x000000;
}
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function collectMeshes(root) {
  const meshes = [];
  root.traverse(o => { if (o.isMesh && o.visible !== false) meshes.push(o); });
  return meshes;
}

// ---------- CHECK 1: bounds ----------
function checkBounds(meshes, THREE, opt, out) {
  const { halfX, halfZ, minY, maxY } = opt.arena;
  const box = new THREE.Box3();
  for (const m of meshes) {
    m.updateWorldMatrix(true, false);
    box.setFromObject(m);
    if (box.isEmpty()) continue;
    const overX = Math.max(box.max.x - halfX, -halfX - box.min.x, 0);
    const overZ = Math.max(box.max.z - halfZ, -halfZ - box.min.z, 0);
    const overYlo = Math.max(minY - box.min.y, 0);
    const overYhi = Math.max(box.max.y - maxY, 0);
    if (Math.max(overX, overZ, overYlo, overYhi) <= opt.boundsEpsilon) continue;

    const sizeX = box.max.x - box.min.x, sizeZ = box.max.z - box.min.z;
    const fits = sizeX <= 2 * halfX && sizeZ <= 2 * halfZ;
    out.violations.push({
      check: 'bounds',
      mesh: m.name || m.uuid.slice(0, 8),
      detail: { overX: +overX.toFixed(2), overZ: +overZ.toFixed(2), overYlo: +overYlo.toFixed(2), overYhi: +overYhi.toFixed(2) },
      repair: fits ? 'clamp' : 'cull',
      _obj: m,
      _clampDelta: fits ? {
        x: box.max.x > halfX ? halfX - box.max.x : (box.min.x < -halfX ? -halfX - box.min.x : 0),
        z: box.max.z > halfZ ? halfZ - box.max.z : (box.min.z < -halfZ ? -halfZ - box.min.z : 0),
        y: overYhi > 0 ? -overYhi : (overYlo > 0 ? overYlo : 0),
      } : null,
    });
  }
}

// ---------- CHECK 2: spawn clearance ----------
function checkSpawnClear(meshes, THREE, opt, out) {
  const box = new THREE.Box3();
  for (const s of opt.spawns) {
    for (const m of meshes) {
      if (m.userData && m.userData.certExempt) continue; // ground plates etc.
      box.setFromObject(m);
      if (box.isEmpty()) continue;
      // circle (spawn XZ) vs rect (mesh XZ AABB)
      const cx = clamp(s.x, box.min.x, box.max.x);
      const cz = clamp(s.z, box.min.z, box.max.z);
      const dx = s.x - cx, dz = s.z - cz;
      const inXZ = dx * dx + dz * dz < opt.spawnRadius * opt.spawnRadius;
      const inY = box.max.y > s.y - 0.5 && box.min.y < s.y + opt.spawnHeight;
      // skip the surface the spawn stands on (thin, top ≈ spawn y)
      const isFloor = Math.abs(box.max.y - s.y) < 0.6 && (box.max.y - box.min.y) < 2.5;
      if (inXZ && inY && !isFloor) {
        // place mesh center at spawn + dir * (radius + halfDiag + margin)
        // so the closest AABB point is guaranteed outside the cylinder
        const bcx = (box.min.x + box.max.x) / 2, bcz = (box.min.z + box.max.z) / 2;
        let dirx = bcx - s.x, dirz = bcz - s.z;
        const len = Math.hypot(dirx, dirz);
        if (len < 1e-3) { dirx = 1; dirz = 0; } else { dirx /= len; dirz /= len; }
        const halfDiag = Math.hypot(box.max.x - box.min.x, box.max.z - box.min.z) / 2;
        const push = opt.spawnRadius + halfDiag + 0.5;
        out.violations.push({
          check: 'spawnClear',
          mesh: m.name || m.uuid.slice(0, 8),
          detail: { spawn: { x: s.x, z: s.z } },
          repair: 'offset',
          _obj: m,
          _offsetDelta: {
            x: (s.x + dirx * push) - bcx,
            z: (s.z + dirz * push) - bcz,
          },
        });
      }
    }
  }
}

// ---------- CHECK 3: drivability (grid raycast + flood fill) ----------
function checkDrivable(meshes, THREE, opt, out) {
  const { halfX, halfZ, maxY } = opt.arena;
  const g = opt.grid;
  const nx = Math.floor((2 * halfX) / g), nz = Math.floor((2 * halfZ) / g);
  const H = new Float32Array(nx * nz).fill(NaN);
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const origin = new THREE.Vector3();

  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    origin.set(-halfX + (i + 0.5) * g, maxY + 10, -halfZ + (j + 0.5) * g);
    ray.set(origin, down);
    const hit = ray.intersectObjects(meshes, false)[0];
    if (hit) H[i * nz + j] = hit.point.y;
  }

  const maxGrade = deg2tan(opt.maxSlopeDeg);
  const drivable = new Uint8Array(nx * nz);
  let drivableCount = 0;
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const h = H[i * nz + j];
    if (Number.isNaN(h)) continue;
    let ok = true;
    for (const [di, dj] of [[1, 0], [0, 1]]) {
      const ii = i + di, jj = j + dj;
      if (ii >= nx || jj >= nz) continue;
      const hn = H[ii * nz + jj];
      if (Number.isNaN(hn)) continue;
      const dh = Math.abs(hn - h);
      if (dh > opt.stepHeight && dh / g > maxGrade) { ok = false; break; }
    }
    if (ok) { drivable[i * nz + j] = 1; drivableCount++; }
  }

  // corridor erosion: cell must have a trackWidth-wide drivable neighborhood
  const r = Math.max(1, Math.round(opt.trackWidth / 2 / g));
  const wide = new Uint8Array(nx * nz);
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    if (!drivable[i * nz + j]) continue;
    let ok = true;
    for (let di = -r; di <= r && ok; di++) for (let dj = -r; dj <= r; dj++) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
      if (!drivable[ii * nz + jj]) { ok = false; break; }
    }
    if (ok) wide[i * nz + j] = 1;
  }

  // connectivity from first spawn over wide cells
  const s = opt.spawns[0] || { x: 0, z: 0 };
  const si = clamp(Math.floor((s.x + halfX) / g), 0, nx - 1);
  const sj = clamp(Math.floor((s.z + halfZ) / g), 0, nz - 1);
  let start = -1;
  outer: for (let rad = 0; rad < Math.max(nx, nz); rad++) {
    for (let di = -rad; di <= rad; di++) for (let dj = -rad; dj <= rad; dj++) {
      const ii = si + di, jj = sj + dj;
      if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
      if (wide[ii * nz + jj]) { start = ii * nz + jj; break outer; }
    }
  }
  let reached = 0, wideCount = 0;
  for (let k = 0; k < wide.length; k++) wideCount += wide[k];
  if (start >= 0) {
    const seen = new Uint8Array(nx * nz); const q = [start]; seen[start] = 1;
    while (q.length) {
      const c = q.pop(); reached++;
      const ci = Math.floor(c / nz), cj = c % nz;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = ci + di, jj = cj + dj;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
        const k = ii * nz + jj;
        if (wide[k] && !seen[k]) { seen[k] = 1; q.push(k); }
      }
    }
  }

  const total = nx * nz;
  const stats = {
    drivableFraction: +(drivableCount / total).toFixed(3),
    corridorFraction: +(wideCount / Math.max(1, drivableCount)).toFixed(3),
    connectedFraction: +(reached / Math.max(1, wideCount)).toFixed(3),
    cells: total,
  };
  out.cert.drivable = stats;

  if (stats.drivableFraction < opt.minDrivableFraction)
    out.violations.push({ check: 'drivable', detail: stats, repair: 'reprompt',
      hint: `Only ${(stats.drivableFraction * 100) | 0}% of the arena is drivable; need ${(opt.minDrivableFraction * 100) | 0}%. Widen basins, soften slopes below ${opt.maxSlopeDeg} deg.` });
  if (start >= 0 && stats.connectedFraction < opt.minConnectedFraction)
    out.violations.push({ check: 'connectivity', detail: stats, repair: 'reprompt',
      hint: `Drivable space is fragmented (${(stats.connectedFraction * 100) | 0}% reachable from spawn). Bridge regions with ramps wider than ${opt.trackWidth}m, grade under ${opt.maxSlopeDeg} deg.` });
  if (start < 0)
    out.violations.push({ check: 'spawnStranded', detail: { spawn: s }, repair: 'relocateSpawn',
      hint: 'No wide drivable cell near spawn; move spawn onto the main basin or clear the corridor.' });
}

// ---------- CHECK 4: contrast & fog ----------
function checkContrast(meshes, THREE, opt, out) {
  const atmo = opt.atmosphere || {};
  const Lfog = luminance(toHexNum(atmo.fog ?? 0x8a9ca4));
  const Lground = luminance(toHexNum(atmo.ground ?? 0x56656a));
  const gap = Math.abs(Lfog - Lground);
  out.cert.contrast = { fogGroundGap: +gap.toFixed(3) };

  if (gap < opt.minLuminanceGap) {
    // push ground toward doctrine dark, fog toward doctrine light
    out.violations.push({
      check: 'contrast', detail: { Lfog: +Lfog.toFixed(3), Lground: +Lground.toFixed(3) },
      repair: 'recolor',
      _recolor: { ground: opt.doctrine.darkGround, fog: Lfog > Lground ? undefined : opt.doctrine.lightSky },
    });
  }

  // material vs fog washout: sample lambert/standard material colors
  let washed = 0, sampled = 0;
  for (const m of meshes) {
    const c = m.material && m.material.color; if (!c) continue;
    sampled++;
    if (Math.abs(luminance(c.getHex()) - Lfog) < opt.minLuminanceGap * 0.6) washed++;
  }
  out.cert.contrast.washedMaterials = washed;
  if (sampled && washed / sampled > 0.5)
    out.violations.push({ check: 'washout', detail: { washed, sampled }, repair: 'reprompt',
      hint: 'Over half the materials sit at fog luminance; separate object palette from atmosphere or reduce fog.' });

  const fogFar = atmo.fogFar;
  if (fogFar != null) {
    const diag = Math.hypot(opt.arena.halfX * 2, opt.arena.halfZ * 2);
    out.cert.contrast.fogFar = fogFar;
    if (fogFar < diag * opt.minFogFar)
      out.violations.push({ check: 'fogDensity', detail: { fogFar, need: +(diag * opt.minFogFar).toFixed(0) },
        repair: 'refog', _refog: { fogFar: Math.ceil(diag * opt.minFogFar) } });
  }
}

// ---------- main entry ----------
export function certify(root, THREE, options = {}) {
  const opt = { ...DEFAULTS, ...options, arena: { ...DEFAULTS.arena, ...(options.arena || {}) } };
  opt.spawns = options.spawns || [{ x: 0, y: 1, z: 20 }];

  const meshes = collectMeshes(root);
  const out = { ok: false, cert: { meshes: meshes.length }, violations: [], promptFeedback: '' };

  const t0 = Date.now();
  checkBounds(meshes, THREE, opt, out);
  checkSpawnClear(meshes, THREE, opt, out);
  checkDrivable(meshes, THREE, opt, out);
  checkContrast(meshes, THREE, opt, out);
  out.cert.ms = Date.now() - t0;

  out.ok = out.violations.length === 0;
  out.cert.violations = out.violations.length;
  out.cert.hash = fnv1a(JSON.stringify({ c: out.cert, v: out.violations.map(v => [v.check, v.mesh, v.detail]) }));

  const reprompts = out.violations.filter(v => v.repair === 'reprompt' || v.repair === 'relocateSpawn');
  if (reprompts.length) {
    out.promptFeedback =
      'WORLDCERT FAILED. Repair the build function without changing its style:\n' +
      reprompts.map(v => `- [${v.check}] ${v.hint}`).join('\n');
  }
  return out;
}

// ---------- mechanical repairs ----------
export function applyRepairs(report, THREE, scene) {
  const applied = [];
  for (const v of report.violations) {
    switch (v.repair) {
      case 'clamp':
        if (v._obj && v._clampDelta) {
          v._obj.position.x += v._clampDelta.x;
          v._obj.position.y += v._clampDelta.y;
          v._obj.position.z += v._clampDelta.z;
          v._obj.updateWorldMatrix(true, false);
          applied.push(`clamp ${v.mesh}`);
        }
        break;
      case 'cull':
        if (v._obj) { v._obj.visible = false; v._obj.userData.culledByCert = true; applied.push(`cull ${v.mesh}`); }
        break;
      case 'offset':
        if (v._obj && v._offsetDelta) {
          v._obj.position.x += v._offsetDelta.x;
          v._obj.position.z += v._offsetDelta.z;
          v._obj.updateWorldMatrix(true, false);
          applied.push(`offset ${v.mesh}`);
        }
        break;
      case 'recolor':
        applied.push('recolor atmosphere'); // caller re-applies WG.atmosphere with v._recolor
        break;
      case 'refog':
        applied.push('refog'); // caller sets scene.fog.far = v._refog.fogFar
        break;
    }
  }
  return applied;
}
