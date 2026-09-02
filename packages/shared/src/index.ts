// @cia/shared — intent schema, canonicalization, hashing and constraint checks.
// Browser bundles should import "@cia/shared/core" (no node:crypto dependency).
export * from "./core.js";
export { hashIntent } from "./hash.js";
