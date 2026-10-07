import test from 'node:test';
import assert from 'node:assert/strict';
import { reduce, initialState, PHASES } from '../../viewer/src/state.js';

const run = (events, start = initialState) => events.reduce(reduce, start);
const ready = () => run([
  { type: 'HELPER_UP' },
  { type: 'VERSIONS_CHANGED', count: 3 },
  { type: 'PAIR_SELECTED', olderId: 'a', newerId: 'b' },
  { type: 'CONVERT_DONE', identical: false, counts: { changed: 1 } },
]);

test('starts empty; fewer than two versions stays empty', () => {
  assert.equal(initialState.phase, 'empty');
  assert.equal(run([{ type: 'HELPER_UP' }, { type: 'VERSIONS_CHANGED', count: 1 }]).phase, 'empty');
});

test('two versions and a pair lead to loading, then ready or identical', () => {
  const loading = run([{ type: 'HELPER_UP' }, { type: 'VERSIONS_CHANGED', count: 2 }, { type: 'PAIR_SELECTED', olderId: 'a', newerId: 'b' }]);
  assert.equal(loading.phase, 'loading');
  assert.equal(reduce(loading, { type: 'CONVERT_DONE', identical: false }).phase, 'ready');
  assert.equal(reduce(loading, { type: 'CONVERT_DONE', identical: true }).phase, 'identical');
});

test('THE SCREENSHOT BUG: helper going away while a comparison is shown leaves no stale result', () => {
  const s = ready();
  assert.equal(s.phase, 'ready');
  assert.ok(s.result);
  const down = reduce(s, { type: 'HELPER_DOWN' });
  assert.equal(down.phase, 'helper-missing');
  assert.equal(down.result, null);
  assert.equal(down.error, null);
});

test('helper returning re-enters loading (result must be recomputed), not the old result', () => {
  const back = run([{ type: 'HELPER_DOWN' }, { type: 'HELPER_UP' }], ready());
  assert.equal(back.phase, 'loading');
  assert.equal(back.result, null);
});

test('selecting another pair drops the previous result immediately', () => {
  const s = reduce(ready(), { type: 'PAIR_SELECTED', olderId: 'b', newerId: 'c' });
  assert.equal(s.phase, 'loading');
  assert.equal(s.result, null);
});

test('a failed conversion shows the error and nothing else; a new pair clears it', () => {
  const loading = reduce(ready(), { type: 'PAIR_SELECTED', olderId: 'b', newerId: 'c' });
  const failed = reduce(loading, { type: 'CONVERT_FAILED', message: 'damaged', fileName: 'b.toe' });
  assert.equal(failed.phase, 'error');
  assert.equal(failed.result, null);
  assert.deepEqual(failed.error, { message: 'damaged', fileName: 'b.toe' });
  const retry = reduce(failed, { type: 'PAIR_SELECTED', olderId: 'a', newerId: 'c' });
  assert.equal(retry.phase, 'loading');
  assert.equal(retry.error, null);
});

test('removing versions below two empties the view and the pair', () => {
  const s = reduce(ready(), { type: 'VERSIONS_CHANGED', count: 1 });
  assert.equal(s.phase, 'empty');
  assert.equal(s.pair, null);
  assert.equal(s.result, null);
});

test('progress only exists while loading', () => {
  const loading = reduce(run([{ type: 'HELPER_UP' }, { type: 'VERSIONS_CHANGED', count: 2 }, { type: 'PAIR_SELECTED', olderId: 'a', newerId: 'b' }]), { type: 'CONVERT_START', total: 2 });
  assert.deepEqual(loading.progress, { done: 0, total: 2 });
  assert.deepEqual(reduce(loading, { type: 'CONVERT_PROGRESS', done: 1, total: 2 }).progress, { done: 1, total: 2 });
  assert.equal(reduce(loading, { type: 'CONVERT_DONE', identical: false }).progress, null);
  assert.equal(reduce(ready(), { type: 'CONVERT_PROGRESS', done: 1, total: 2 }).progress, null);
});

test('late results after the helper went away are ignored', () => {
  const down = reduce(reduce(initialState, { type: 'VERSIONS_CHANGED', count: 2 }), { type: 'HELPER_DOWN' });
  assert.equal(reduce(down, { type: 'CONVERT_DONE', identical: false }).phase, 'helper-missing');
  assert.equal(reduce(down, { type: 'CONVERT_FAILED', message: 'x' }).phase, 'helper-missing');
});

test('unknown events change nothing', () => {
  const s = ready();
  assert.equal(reduce(s, { type: 'NOPE' }), s);
});

test('invariants hold for every sequence of up to 6 events', () => {
  const alphabet = [
    { type: 'HELPER_UP' }, { type: 'HELPER_DOWN' },
    { type: 'VERSIONS_CHANGED', count: 0 }, { type: 'VERSIONS_CHANGED', count: 3 },
    { type: 'PAIR_SELECTED', olderId: 'a', newerId: 'b' },
    { type: 'CONVERT_START', total: 2 }, { type: 'CONVERT_DONE', identical: false }, { type: 'CONVERT_DONE', identical: true },
    { type: 'CONVERT_FAILED', message: 'x' },
  ];
  let checked = 0;
  const walk = (state, depth) => {
    assert.ok(PHASES.includes(state.phase));
    const showsResult = state.phase === 'ready' || state.phase === 'identical';
    assert.equal(Boolean(state.result), showsResult, `result iff ready/identical (${state.phase})`);
    assert.equal(Boolean(state.error), state.phase === 'error', `error iff error phase (${state.phase})`);
    assert.equal(Boolean(state.progress) && state.phase !== 'loading', false, 'progress only while loading');
    if (state.phase === 'helper-missing') assert.equal(state.helper, 'down');
    if (state.phase === 'empty') assert.ok(state.versionCount < 2 || !state.pair);
    checked += 1;
    if (depth === 0) return;
    for (const event of alphabet) walk(reduce(state, event), depth - 1);
  };
  walk(initialState, 5);
  assert.ok(checked > 10000);
});
