/* The real shell, loaded the way test/unit.js loads it, so the "actual"
   rule in this simulator is targetFor itself and not a copy of it. The
   fixture builds a profile from plain sessions; nothing here is part of
   the app. */
const path = require('node:path');
const vm = require('node:vm');
const { loadApp } = require(path.join(__dirname, '..', '..', 'test', 'harness.js'));

const ctx = loadApp();
vm.runInContext(`
  globalThis.__simTarget = function (spec, blockId, week, now) {
    state = defaultState(); migrate();
    state.prefs.units = 'kg';
    const p = { blocks: {}, blockOrder: [], log: {}, rir: {}, obj: {}, variants: {} };
    spec.blocks.forEach(b => {
      p.blocks[b.id] = { id: b.id, name: b.id, weeks: b.weeks, deload: b.deload || 0, phase: b.phase,
                         priority: [], days: [{ id: 'D', name: 'D', ex: [Object.assign({}, spec.ex)] }] };
      p.blockOrder.push(b.id);
    });
    spec.sessions.forEach(s => {
      const blk = p.log[s.block] = p.log[s.block] || {};
      (blk[slot(s.week, 'D')] = blk[slot(s.week, 'D')] || {})[spec.ex.id] = s.sets.map(x => {
        const row = { w: String(x.w), r: String(x.r), done: true, ts: s.ts };
        if (x.rir != null) row.rir = String(x.rir);
        return row;
      });
    });
    const block = p.blocks[blockId];
    const t = targetFor(p, block, block.days[0], block.days[0].ex[0], week, now, false);
    return t ? JSON.parse(JSON.stringify({ kind: t.kind, sets: t.sets, line: targetLine(t), says: targetNotes(t) })) : null;
  };
  globalThis.__simWeekRir = (phase, ex, w) => weekRir({ phase: phase }, ex, w, null);
`, ctx);

module.exports = {
  target: (spec, blockId, week, now) => ctx.__simTarget(spec, blockId, week, now),
  weekRir: (phase, ex, w) => ctx.__simWeekRir(phase, ex, w),
};
