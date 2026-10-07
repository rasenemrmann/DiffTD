// Talks to the local helper (`python3 -m difftd serve`) that reads .toe/.tox files for us.
// Every failure becomes a HelperError with a readable, translated message.

import { t } from './i18n.js';

export class HelperError extends Error {
  /** kind: unreachable | too-large | not-project | unreadable | forbidden | no-toeexpand | generic */
  constructor(kind, message, status = 0) {
    super(message);
    this.name = 'HelperError';
    this.kind = kind;
    this.status = status;
  }
}

function describe(status, body, name) {
  const detail = body?.error ?? `HTTP ${status}`;
  if (status === 413) return new HelperError('too-large', t('err.tooLarge', { name, mb: 200 }), status);
  if (status === 415) return new HelperError('not-project', t('err.notProject', { name }), status);
  if (status === 422) return new HelperError('unreadable', t('err.unreadable', { name, detail: detail.replace(`${name}: `, '') }), status);
  if (status === 403) return new HelperError('forbidden', t('err.forbidden'), status);
  return new HelperError('generic', t('err.generic', { detail }), status);
}

export function createHelperClient({ baseUrl = '', fetchImpl = (...a) => globalThis.fetch(...a) } = {}) {
  async function request(path, options = {}, name = '') {
    let res;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, options);
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      throw new HelperError('unreachable', t('err.unreachable'));
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) throw describe(res.status, body, name);
    return body;
  }

  return {
    /** { folder, toeexpand, problem, uploadLimitBytes, version } */
    async info() {
      const info = await request('/api/info');
      if (info.problem) throw new HelperError('no-toeexpand', t('err.noToeexpand'));
      return info;
    },
    versions: () => request('/api/versions'),
    snapshotsOfFile: async (file) => (await request(`/api/snapshot?file=${encodeURIComponent(file)}`, {}, file)).roots,
    /** Networks of already converted content, or null. */
    async lookup(sha256) {
      try {
        return (await request(`/api/snapshot?sha256=${sha256}`)).roots;
      } catch (err) {
        if (err instanceof HelperError && err.status === 404) return null;
        throw err;
      }
    },
    /** Convert file bytes; resolves with { project1: snapshot, ... }. */
    async convert(file, sha256, { signal } = {}) {
      const query = `sha256=${sha256}&name=${encodeURIComponent(file.name)}`;
      const body = await request(
        `/api/convert?${query}`,
        { method: 'POST', body: file, signal, headers: { 'X-DiffTD': '1', 'Content-Type': 'application/octet-stream' } },
        file.name,
      );
      return body.roots;
    },
    async isUp() {
      try {
        await request('/api/info');
        return true;
      } catch (err) {
        return !(err instanceof HelperError && err.kind === 'unreachable');
      }
    },
  };
}

/**
 * Poll the helper: onChange(true|false) is called when reachability changes (and once at the start).
 * Retries with growing delay (1 s → 10 s) while it is down. Returns stop().
 */
export function watchHelper(client, onChange, { minMs = 1000, maxMs = 10000, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let stopped = false;
  let last = null;
  let delay = minMs;
  let timer = null;
  const tick = async () => {
    const up = await client.isUp();
    if (stopped) return;
    if (up !== last) {
      last = up;
      onChange(up);
    }
    delay = up ? maxMs : Math.min(maxMs, delay * 2);
    if (!up && last === false && delay === minMs * 2) delay = minMs;
    timer = setTimer(tick, up ? maxMs : delay);
  };
  tick();
  return () => {
    stopped = true;
    if (timer !== null) clearTimer(timer);
  };
}
