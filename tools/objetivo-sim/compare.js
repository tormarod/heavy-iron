/* Every rule against the same lifters, averaged.
     node tools/objetivo-sim/compare.js
   Narrow the matrix with env vars: EX=chestpress,lateral  BEHAVE=target
   LOGS=none  GAIN=0.005  SEEDS=5  BLOCKS=3  SD=0.03  CURVE=brzycki
   RULES=actual,rango */
const S = require('./lifter.js');
const R = require('./rules.js');
const env = (k, d) => process.env[k] || d;
const rules = env('RULES', 'actual,actualFixed,todas,primera,rango').split(',');
const behaves = env('BEHAVE', 'target,hybrid,rir,capped').split(',');
const logs = env('LOGS', 'none,honest').split(',');
const gains = process.env.GAIN ? [+process.env.GAIN] : [0.012, 0.005, 0];
const exs = env('EX', Object.keys(S.EXERCISES).join(',')).split(',');
const seeds = +env('SEEDS', 5), blocks = +env('BLOCKS', 3), sd = +env('SD', 0.03), curve = env('CURVE', 'epley');
const cols = ['weird', 'repsDown', 'weightDown', 'stale', 'split', 'hit', 'beat', 'effort', 'junk',
              'inRange', 'near', 'rirOk', 'perStep', 'loadGain', 'strengthGain'];
const out = {};
let runs = 0;
rules.forEach(rn => {
  const acc = {}; let n = 0;
  exs.forEach(ex => behaves.forEach(b => logs.forEach(lg => gains.forEach(g => {
    for (let s = 1; s <= seeds; s++) {
      const L = S.makeLifter({ seed: s * 101 + ex.length * 7 + b.length, gain: g, sd, behave: b, logRir: lg, curve });
      const sc = S.score(S.run(R[rn], ex, L, blocks));
      cols.forEach(k => { acc[k] = (acc[k] || 0) + sc[k]; });
      n++;
    }
  }))));
  runs = n;
  out[rn] = {};
  cols.forEach(k => { out[rn][k] = Math.round(10 * acc[k] / n) / 10; });
});
console.log(runs + ' runs per rule, ' + blocks + ' blocks of 8 weeks each');
console.log('rule        ' + cols.map(c => c.slice(0, 8).padStart(8)).join(' '));
rules.forEach(rn => console.log(rn.padEnd(12) + cols.map(c => String(out[rn][c]).padStart(8)).join(' ')));
