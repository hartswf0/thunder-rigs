// Headless proof: rebuild the failure scene from the forge log and
// show certify() catching it, applyRepairs() fixing the mechanical
// part, and a re-run going green.
import * as THREE from 'three';
import { certify, applyRepairs } from './certify.js';

function box(w, h, d, color, name) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshBasicMaterial({ color })
  );
  m.name = name;
  return m;
}

function buildBadWorld() {
  const root = new THREE.Group();

  // base 170x170 like the forge output
  const base = box(170, 1.4, 170, 0x617177, 'base'); base.position.set(0, -0.7, 0); root.add(base);
  const road = box(11, 0.36, 150, 0x7c8d92, 'road'); road.position.set(0, 0.18, 0); root.add(road);

  // THE BRIDGE — the frozen route spine marching out of the arena
  const bridge = box(8, 1, 90, 0x6d7d84, 'bridge-spine');
  bridge.position.set(-42, 4, -95);           // extends to z=-140, arena ends at -85
  root.add(bridge);

  // a tower generated ON TOP OF the car spawn (0, 1, 20)
  const tower = box(6, 12, 6, 0x50606a, 'tower-on-spawn');
  tower.position.set(0.5, 6, 20.5);
  root.add(tower);

  // decorative pylons, legal
  for (let i = 0; i < 6; i++) {
    const p = box(1.2, 7, 1.2, 0x1a2226, 'pylon-' + i);
    p.position.set(-30 + i * 12, 3.5, -40);
    root.add(p);
  }
  return root;
}

const atmosphere = { sky: '#6d8592', fog: '#8a9ca4', ground: '#56656a', fogFar: 160 }; // washed + short fog
const spawns = [{ x: 0, y: 0.36 + 0.5, z: 20 }];

console.log('=== PASS 1: raw forge output ===');
const world = buildBadWorld();
let report = certify(world, THREE, { atmosphere, spawns });
console.log('ok:', report.ok, '| cert:', JSON.stringify(report.cert));
for (const v of report.violations)
  console.log(`  VIOLATION [${v.check}] ${v.mesh || ''} -> repair: ${v.repair}`, JSON.stringify(v.detail || {}));
if (report.promptFeedback) console.log('\n--- feedback for model repair pass ---\n' + report.promptFeedback + '\n');

console.log('=== applying mechanical repairs ===');
const applied = applyRepairs(report, THREE);
console.log('applied:', applied.join(', ') || '(none)');

// caller-side repairs the module hands back as data:
const recolor = report.violations.find(v => v.repair === 'recolor');
const fixedAtmo = { ...atmosphere };
if (recolor) {
  if (recolor._recolor.ground != null) fixedAtmo.ground = '#' + recolor._recolor.ground.toString(16).padStart(6, '0');
  if (recolor._recolor.fog != null) fixedAtmo.fog = '#' + recolor._recolor.fog.toString(16).padStart(6, '0');
}
const refog = report.violations.find(v => v.repair === 'refog');
if (refog) fixedAtmo.fogFar = refog._refog.fogFar;

console.log('\n=== PASS 2: after repairs ===');
report = certify(world, THREE, { atmosphere: fixedAtmo, spawns });
console.log('ok:', report.ok, '| cert:', JSON.stringify(report.cert));
for (const v of report.violations)
  console.log(`  VIOLATION [${v.check}] ${v.mesh || ''} -> repair: ${v.repair}`, JSON.stringify(v.detail || {}));

process.exit(report.ok ? 0 : 1);
