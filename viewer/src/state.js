// View state of the comparison area (pure reducer). Exactly one phase at a time; whatever belongs
// to another phase is cleared on every transition, so nothing stale can be shown (FR-014).

export const PHASES = ['helper-missing', 'empty', 'loading', 'ready', 'identical', 'error'];

export const initialState = Object.freeze({
  phase: 'empty',
  helper: 'unknown', // unknown | up | down
  versionCount: 0,
  pair: null, // { olderId, newerId }
  result: null, // { identical, counts } while ready / identical
  error: null, // { message, fileName? } while error
  progress: null, // { done, total } while loading
});

/** The phase that follows from the facts in `s`, ignoring the previous phase. */
function settle(s) {
  if (s.helper === 'down') return { ...s, phase: 'helper-missing', result: null, error: null, progress: null };
  if (s.versionCount < 2 || !s.pair) return { ...s, phase: 'empty', result: null, error: null, progress: null, pair: s.versionCount < 2 ? null : s.pair };
  if (s.error) return { ...s, phase: 'error', result: null, progress: null };
  if (s.result) return { ...s, phase: s.result.identical ? 'identical' : 'ready', error: null, progress: null };
  return { ...s, phase: 'loading', result: null, error: null };
}

export function reduce(state, event) {
  switch (event.type) {
    case 'HELPER_DOWN':
      return settle({ ...state, helper: 'down', result: null });
    case 'HELPER_UP':
      return settle({ ...state, helper: 'up' });
    case 'VERSIONS_CHANGED': {
      const next = { ...state, versionCount: event.count };
      if (event.count < 2) return settle({ ...next, pair: null, result: null, error: null });
      return settle(next);
    }
    case 'PAIR_SELECTED':
      return settle({ ...state, pair: { olderId: event.olderId, newerId: event.newerId }, result: null, error: null, progress: null });
    case 'CONVERT_START':
      if (state.helper === 'down' || state.versionCount < 2) return state;
      return { ...state, phase: 'loading', result: null, error: null, progress: { done: 0, total: event.total ?? 0 } };
    case 'CONVERT_PROGRESS':
      return state.phase === 'loading' ? { ...state, progress: { done: event.done, total: event.total } } : state;
    case 'CONVERT_DONE':
      if (state.phase !== 'loading') return state;
      return settle({ ...state, result: { identical: Boolean(event.identical), counts: event.counts ?? null }, error: null });
    case 'CONVERT_FAILED':
      if (state.phase === 'helper-missing') return state;
      return settle({ ...state, error: { message: event.message, fileName: event.fileName ?? null }, result: null });
    default:
      return state;
  }
}
