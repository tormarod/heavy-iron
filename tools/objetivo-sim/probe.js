/* Hand-built histories through the real targetFor — no simulated lifter,
   no noise — one per way it goes wrong.
     node tools/objetivo-sim/probe.js */
const app = require('./app.js');
const DAY = 86400000, T0 = Date.UTC(2026, 0, 5);
const PH = require('./lifter.js').PHASE;
const chest = { id: 'cp', n: 'Press de pecho', sets: 4, inc: 2.5, reps: '6–10' };
function ask(sessions, block, week, nowDay, nBlocks) {
  const blocks = [];
  for (let b = 1; b <= (nBlocks || 1); b++) blocks.push({ id: 'B' + b, weeks: 8, deload: 8, phase: PH });
  const spec = { ex: chest, blocks, sessions: sessions.map(s => ({ block: s.b || 'B1', week: s.w, ts: T0 + s.d * DAY,
    sets: s.sets.map((x, k) => ({ w: x[0], r: x[1], rir: s.rir ? s.rir[k] : null })) })) };
  const t = app.target(spec, block, week, T0 + nowDay * DAY);
  return t ? t.line + (t.says.length ? '\n      ' + t.says.join('\n      ') : '') : null;
}
const s = (w, d, reps, rir, b) => ({ w, d, b, rir, sets: reps.map(r => [60, r]) });
console.log('1. Week 1 (3 RIR) → week 2 (2–3 RIR), RIR box left empty. Did 60 × 9·8·8·7:');
console.log('   ' + ask([s(1, 0, [9, 8, 8, 7])], 'B1', 2, 7));
console.log('   …the same session with 3·3·3·3 typed in the RIR box:');
console.log('   ' + ask([s(1, 0, [9, 8, 8, 7], [3, 3, 3, 3])], 'B1', 2, 7));
console.log('2. Week 3 → week 4, RIR box empty. Did 60 × 10·9·8·7:');
console.log('   ' + ask([s(3, 0, [10, 9, 8, 7])], 'B1', 4, 7));
console.log('3. Week 3 → week 4, RIR box empty. Did 60 × 9·8·7·6:');
console.log('   ' + ask([s(3, 0, [9, 8, 7, 6])], 'B1', 4, 7));
console.log('4. First session of the next block, one week after the deload. Week 7 was 60 × 10·9·9·8 at 0–1 RIR:');
const blk = [];
for (let w = 1; w <= 7; w++) { const k = Math.floor(w / 2); blk.push(s(w, (w - 1) * 7, [7 + k, 6 + k, 6 + k, 5 + k])); }
blk.push({ w: 8, d: 49, sets: [[35, 6], [35, 6]] });
console.log('   ' + ask(blk, 'B2', 1, 56, 2));
