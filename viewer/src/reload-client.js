// Ask the running TouchDesigner project to reload snapshot files (browser only).
// Only called after the user's explicit confirmation (FR-018).

export const DEFAULT_PORT = 9980;

const base = (port) => `http://127.0.0.1:${port}`;

/** Resolves with the health payload, rejects with a readable message. */
export async function checkHealth(port = DEFAULT_PORT) {
  let res;
  try {
    res = await fetch(`${base(port)}/health`);
  } catch {
    throw new Error(`TouchDesigner is not reachable on port ${port}. Is the project open and DiffTD running? (If it is, check allowedOrigins in difftd.config.json.)`);
  }
  if (!res.ok) throw new Error(`TouchDesigner answered ${res.status} on /health.`);
  return res.json();
}

/** POST /reload with repo-relative snapshot paths; returns the endpoint's report. */
export async function requestReload(files, port = DEFAULT_PORT) {
  await checkHealth(port);
  const res = await fetch(`${base(port)}/reload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files, source: 'viewer' }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Reload failed with status ${res.status}.`);
  return body;
}

export function summarizeReload(report) {
  const parts = [];
  if (report.reloaded?.length) parts.push(`reloaded ${report.reloaded.join(', ')}`);
  if (report.unchanged?.length) parts.push(`already up to date: ${report.unchanged.join(', ')}`);
  if (report.removed?.length) parts.push(`removed ${report.removed.join(', ')}`);
  if (report.backups?.length) parts.push(`unsaved edits backed up to ${report.backups.map((b) => b.file).join(', ')}`);
  const skipped = (report.skippedNodes?.length ?? 0) + (report.skippedParams?.length ?? 0);
  if (skipped) parts.push(`${skipped} item(s) skipped (see .difftd/log.txt)`);
  if (report.errors?.length) parts.push(`errors: ${report.errors.map((e) => `${e.file}: ${e.message}`).join('; ')}`);
  return parts.join(' · ') || 'nothing to do';
}
