/**
 * The complete set of platform capabilities the domain assumes.
 *
 * `packages/domain` deliberately has neither `@types/node` nor the DOM lib, so
 * that boundary MB-1 is enforced by the compiler rather than by discipline —
 * `fs`, `process` and `window` are all type errors here.
 *
 * Web Crypto's `getRandomValues` is the one exception, needed by the UUIDv7
 * generator. It is declared narrowly rather than by pulling in a whole lib,
 * which keeps this file an explicit, reviewable inventory: anything the domain
 * touches beyond pure computation has to be added here first, and that is a
 * visible decision in a diff.
 */

declare const crypto: {
  getRandomValues<T extends Uint8Array>(array: T): T
}
