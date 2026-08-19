import type { AddressCapabilities, AddressType } from "../types.js";
import type { Classification, Plugin, PluginContext } from "../plugin.js";

/**
 * Default capabilities implied by each address type.
 *
 * The courier flags are the commercially load-bearing ones: UPS, FedEx and DHL
 * all refuse PO Boxes, which is a bug e-commerce sites rediscover constantly.
 */
const CAPABILITIES: Record<AddressType, AddressCapabilities> = {
  street:           { courierDeliverable: true,  postalDeliverable: true, residential: true,  requiresCustomsDeclaration: false },
  po_box:           { courierDeliverable: false, postalDeliverable: true, residential: false, requiresCustomsDeclaration: false },
  military:         { courierDeliverable: false, postalDeliverable: true, residential: true,  requiresCustomsDeclaration: true  },
  general_delivery: { courierDeliverable: false, postalDeliverable: true, residential: false, requiresCustomsDeclaration: false },
  rural_route:      { courierDeliverable: false, postalDeliverable: true, residential: true,  requiresCustomsDeclaration: false },
  highway_contract: { courierDeliverable: false, postalDeliverable: true, residential: true,  requiresCustomsDeclaration: false },
  parcel_locker:    { courierDeliverable: true,  postalDeliverable: true, residential: false, requiresCustomsDeclaration: false },
  unknown:          { courierDeliverable: true,  postalDeliverable: true, residential: true,  requiresCustomsDeclaration: false },
};

export function capabilitiesFor(type: AddressType): AddressCapabilities {
  return { ...CAPABILITIES[type] };
}

/** Joined, case-folded haystack of the parts a type marker can appear in. */
function haystack(ctx: PluginContext): string {
  const a = ctx.address;
  return [...(a.streetAddress ?? []), a.locality ?? "", a.organization ?? ""]
    .join("\n")
    .toUpperCase();
}

/**
 * PO Box detection across the major postal languages.
 *
 * Each pattern is anchored to a line start or a word boundary so that a street
 * genuinely named "Boxwood Lane" or "Postbus­straat" is not misread. The
 * trailing digit requirement matters too: "PO Box" with no number is not a
 * usable PO Box address and should stay `street` so the missing-number problem
 * surfaces as a normal validation issue.
 */
const PO_BOX_PATTERNS: RegExp[] = [
  /\bP\.?\s?O\.?\s*BOX\s*#?\s*\d+/,            // en: PO Box 123, P.O. Box 123
  /\bPOST\s*(?:OFFICE\s*)?BOX\s*#?\s*\d+/,     // en: Post Office Box 123
  /\bPOSTFACH\s*\d+/,                          // de
  /\bBO[IÎ]TE\s*POSTALE\s*\d+/,                // fr
  /\bB\.?\s?P\.?\s*\d+/,                       // fr abbreviated
  /\bAPARTADO\s*(?:POSTAL\s*)?\d+/,            // es
  /\bCAIXA\s*POSTAL\s*\d+/,                    // pt
  /\bCASELLA\s*POSTALE\s*\d+/,                 // it
  /\bPOSTBUS\s*\d+/,                           // nl
  /\bSKRYTKA\s*POCZTOWA\s*\d+/,                // pl
  /\bPOSTBOKS\s*\d+/,                          // da/no
  /\b郵便私書箱\s*\d+/,                          // ja
  /\b邮政信箱\s*\d+/,                            // zh
];

/** USPS Publication 28 canonical forms and the variants people actually type. */
const RURAL_ROUTE = /\b(?:RR|R\.?R\.?|RURAL\s+ROUTE)\s*\d+\s*,?\s*(?:BOX\s*\d+)?/;
const HIGHWAY_CONTRACT = /\b(?:HC|H\.?C\.?|HIGHWAY\s+CONTRACT(?:\s+ROUTE)?)\s*\d+\s*,?\s*(?:BOX\s*\d+)?/;
const GENERAL_DELIVERY = /\b(?:GENERAL\s+DELIVERY|POSTE\s+RESTANTE|LISTA\s+DE\s+CORREOS|FERMO\s+POSTA)\b/;

/** APO/FPO/DPO (US) and BFPO (UK). */
const MILITARY_LOCALITY = /\b(?:APO|FPO|DPO)\b/;
const BFPO = /\bBFPO\s*\d+/;

/** Packstation (DE), InPost (PL), and the generic English form. */
const PARCEL_LOCKER = /\b(?:PACKSTATION|PAKETSTATION|PARCEL\s*LOCKER|AMAZON\s*(?:HUB\s*)?LOCKER|INPOST|PACZKOMAT)\b/;

/**
 * Built-in address type classifier.
 *
 * Confidence values are ordered rather than calibrated: military beats PO Box
 * because an APO address may legitimately contain a PO Box line, and the
 * military designation is the one that changes how the address must be handled.
 */
export const classifyPlugin: Plugin = {
  name: "core:classify",

  classify(ctx): Classification | undefined {
    const text = haystack(ctx);
    const locality = (ctx.address.locality ?? "").toUpperCase();
    const admin = (ctx.address.administrativeArea ?? "").toUpperCase();

    // Military first: an APO address can also match the PO Box pattern, and the
    // military reading is the one that changes the delivery rules.
    if (MILITARY_LOCALITY.test(locality) || BFPO.test(text) || BFPO.test(locality)) {
      return { type: "military", confidence: 0.95 };
    }
    // AA/AE/AP are only ever military "states"; treat them as a strong signal
    // even when the locality was left blank.
    if (/^(?:AA|AE|AP)$/.test(admin)) {
      return { type: "military", confidence: 0.9 };
    }
    if (GENERAL_DELIVERY.test(text) || GENERAL_DELIVERY.test(locality)) {
      return { type: "general_delivery", confidence: 0.9 };
    }
    if (PARCEL_LOCKER.test(text)) {
      return { type: "parcel_locker", confidence: 0.85 };
    }
    if (HIGHWAY_CONTRACT.test(text)) {
      return { type: "highway_contract", confidence: 0.85 };
    }
    if (RURAL_ROUTE.test(text)) {
      return { type: "rural_route", confidence: 0.85 };
    }
    for (const pattern of PO_BOX_PATTERNS) {
      if (pattern.test(text)) return { type: "po_box", confidence: 0.8 };
    }
    // A street line that looks like a premise. Low confidence so that any
    // country-specific plugin can override it.
    if ((ctx.address.streetAddress ?? []).some((l) => l.trim().length > 0)) {
      return { type: "street", confidence: 0.3 };
    }
    return { type: "unknown", confidence: 0.1 };
  },
};
