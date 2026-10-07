// Snapshot validation driven by schema/snapshot.schema.json (single source of truth).
// Works in the browser (served from the repository root) and under Node.

export const SUPPORTED_FORMAT_VERSION = 1;

export class SnapshotError extends Error {
  constructor(message, errors = []) {
    super(message);
    this.name = 'SnapshotError';
    this.errors = errors;
  }
}

const SCHEMA_URL = new URL('../../schema/snapshot.schema.json', import.meta.url);

async function loadSchemaText() {
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    const { readFile } = await import('node:fs/promises');
    return readFile(SCHEMA_URL, 'utf8');
  }
  const res = await fetch(SCHEMA_URL);
  if (!res.ok) {
    throw new Error(`Cannot load snapshot schema (${res.status}). Serve the repository root, not only viewer/.`);
  }
  return res.text();
}

const schema = JSON.parse(await loadSchemaText());

function typeOk(value, name) {
  switch (name) {
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'array': return Array.isArray(value);
    case 'string': return typeof value === 'string';
    case 'boolean': return typeof value === 'boolean';
    case 'integer': return Number.isInteger(value);
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    default: return false;
  }
}

function check(sch, value, path, errors) {
  if (sch.$ref) {
    let node = schema;
    for (const part of sch.$ref.replace(/^#\//, '').split('/')) node = node[part];
    check(node, value, path, errors);
    return;
  }
  if (sch.oneOf) {
    let matches = 0;
    for (const sub of sch.oneOf) {
      const subErrors = [];
      check(sub, value, path, subErrors);
      if (subErrors.length === 0) matches += 1;
    }
    if (matches !== 1) errors.push({ code: 'schema', path, message: 'does not match any allowed form' });
    return;
  }
  if ('const' in sch && value !== sch.const) {
    errors.push({ code: 'schema', path, message: `must be ${JSON.stringify(sch.const)}` });
    return;
  }
  if (sch.type) {
    const types = Array.isArray(sch.type) ? sch.type : [sch.type];
    if (!types.some((t) => typeOk(value, t))) {
      errors.push({ code: 'schema', path, message: `must be of type ${types.join('/')}` });
      return;
    }
  }
  if (typeof value === 'string') {
    if (value.length < (sch.minLength ?? 0)) errors.push({ code: 'schema', path, message: 'must not be empty' });
    if (sch.pattern && !new RegExp(sch.pattern).test(value)) {
      errors.push({ code: 'schema', path, message: 'has an invalid format' });
    }
  }
  if (typeof value === 'number' && sch.minimum !== undefined && value < sch.minimum) {
    errors.push({ code: 'schema', path, message: `must be >= ${sch.minimum}` });
  }
  if (typeOk(value, 'object')) {
    for (const key of sch.required ?? []) {
      if (!(key in value)) errors.push({ code: 'schema', path, message: `missing required '${key}'` });
    }
    const props = sch.properties ?? {};
    for (const [key, sub] of Object.entries(value)) {
      if (key in props) check(props[key], sub, `${path}/${key}`, errors);
      else if (sch.additionalProperties === false) {
        errors.push({ code: 'schema', path, message: `unexpected property '${key}'` });
      } else if (sch.additionalProperties && typeof sch.additionalProperties === 'object') {
        check(sch.additionalProperties, sub, `${path}/${key}`, errors);
      }
    }
  }
  if (Array.isArray(value) && sch.items) {
    value.forEach((item, i) => check(sch.items, item, `${path}/${i}`, errors));
  }
}

/** Returns { ok: true } or { ok: false, errors: [{ code, path, message }] }. */
export function validateSnapshot(obj) {
  const version = obj?.meta?.format_version;
  if (Number.isInteger(version) && version > SUPPORTED_FORMAT_VERSION) {
    return {
      ok: false,
      errors: [{
        code: 'unsupported_version',
        path: '/meta/format_version',
        message: `format version ${version} is newer than supported version ${SUPPORTED_FORMAT_VERSION}`,
      }],
    };
  }
  const errors = [];
  check(schema, obj, '', errors);
  if (errors.length) return { ok: false, errors };

  const paths = obj.nodes.map((n) => n.path);
  const known = new Set(paths);
  if (known.size !== paths.length) {
    const seen = new Set();
    for (const p of paths) {
      if (seen.has(p)) errors.push({ code: 'duplicate_path', path: '/nodes', message: `duplicate node path ${p}` });
      seen.add(p);
    }
  }
  const root = obj.meta.root;
  if (!known.has(root)) errors.push({ code: 'root_missing', path: '/meta/root', message: `root ${root} is not a node` });
  for (const p of paths) {
    if (p !== root && !p.startsWith(`${root}/`)) {
      errors.push({ code: 'outside_root', path: '/nodes', message: `${p} is outside root ${root}` });
    }
  }
  obj.connections.forEach((c, i) => {
    for (const end of ['from', 'to']) {
      if (!known.has(c[end])) {
        errors.push({
          code: 'dangling_connection',
          path: `/connections/${i}/${end}`,
          message: `connection endpoint ${c[end]} is not a node`,
        });
      }
    }
  });
  return errors.length ? { ok: false, errors } : { ok: true };
}

/** Parse snapshot text; throws SnapshotError with a human-readable message. */
export function parseSnapshot(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (err) {
    throw new SnapshotError(`not valid JSON: ${err.message}`);
  }
  const result = validateSnapshot(obj);
  if (!result.ok) {
    const first = result.errors[0];
    throw new SnapshotError(`invalid snapshot: ${first.message} (${first.path || '/'})`, result.errors);
  }
  return obj;
}
