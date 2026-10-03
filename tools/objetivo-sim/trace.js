/* One lifter, two rules, week by week.
     node tools/objetivo-sim/trace.js chestpress hybrid none 0.005 3 actual rango */
const S = require('./lifter.js');
const R = require('./rules.js');
const [ex = 'chestpress', behave = 'hybrid', log = 'none', gain = '0.005', seed = '3', ra = 'actual', rb = 'rango'] = process.argv.slice(2);
const mk = () => S.makeLifter({ seed: +seed, gain: +gain, sd: 0.03, behave, logRir: log, curve: 'epley' });
const a = S.run(R[ra], ex, mk(), 2), b = S.run(R[rb], ex, mk(), 2);
const kg = v => String(Math.round(v * 100) / 100).replace('.', ',');
const ask = t => !t ? '—' : (t.kind === 'descarga' || t.kind === 'vuelta' ? t.kind + ' ' : '') + t.sets.map(p => kg(p.w) + '×' + p.r).join(' · ');
const did = d => d.every(x => x.w === d[0].w) ? kg(d[0].w) + ' × ' + d.map(x => x.r).join('·') : d.map(x => kg(x.w) + '×' + x.r).join(' ');
console.log(`| sem. | RIR | ${ra}: pide | hizo | ${rb}: pide | hizo |`);
console.log('|---|---|---|---|---|---|');
a.trace.forEach((x, i) => {
  const y = b.trace[i];
  console.log(`| B${x.block}·S${x.week} | ${x.q} | ${ask(x.tgt)} | ${did(x.done)} | ${ask(y.tgt)} | ${did(y.done)} |`);
});
