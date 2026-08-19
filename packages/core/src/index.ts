/**
 * SmartAddress core — a reusable, pluggable international address engine.
 *
 * Zero dependencies, no network, no framework. Everything country-specific
 * lives in metadata; everything policy-specific lives in plugins.
 */

export * from "./types.js";
export * from "./metadata.js";
export * from "./plugin.js";
export * from "./engine.js";
export * from "./schema.js";
export { formatAddress, formatOneLine, parseFormatString } from "./format.js";

export { capabilitiesFor, classifyPlugin } from "./plugins/classify.js";
export { structuralPlugin, matchAdministrativeArea, fold } from "./plugins/structural.js";
export { typeRulesPlugin } from "./plugins/typeRules.js";
export { normalizePlugin, postalCodeNormalizePlugin } from "./plugins/normalize.js";
