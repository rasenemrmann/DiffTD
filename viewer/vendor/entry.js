// Bundle entry: isomorphic-git needs a global Buffer in the browser.
import { Buffer } from 'buffer';

globalThis.Buffer ??= Buffer;

export * from 'isomorphic-git';
export { default } from 'isomorphic-git';
