// SHA-256 of a File/Blob/ArrayBuffer/typed array, as lowercase hex (content identity of a version).

export async function sha256Hex(input) {
  let buffer;
  if (input instanceof ArrayBuffer) buffer = input;
  else if (ArrayBuffer.isView(input)) buffer = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  else if (typeof input?.arrayBuffer === 'function') buffer = await input.arrayBuffer();
  else throw new TypeError('sha256Hex expects a File, Blob, ArrayBuffer or typed array');
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
