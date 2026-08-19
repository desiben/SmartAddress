import type { Granularity, Issue } from "../types.js";
import type { Plugin, PluginContext } from "../plugin.js";
import { capabilitiesFor } from "./classify.js";

function issue(
  code: Issue["code"],
  severity: Issue["severity"],
  message: string,
  field?: Issue["field"],
  meta?: Issue["meta"],
): Issue {
  return {
    code,
    severity,
    message,
    ...(field ? { field } : {}),
    ...(meta ? { meta } : {}),
    source: "core:type-rules",
  };
}

/** The three military "states" and the ZIP ranges each is allowed to use. */
const MILITARY_REGIONS: Record<string, { name: string; zipPrefixes: string[] }> = {
  AA: { name: "Armed Forces Americas", zipPrefixes: ["340"] },
  AE: { name: "Armed Forces Europe", zipPrefixes: ["090", "091", "092", "093", "094", "095", "096", "097", "098"] },
  AP: { name: "Armed Forces Pacific", zipPrefixes: ["962", "963", "964", "965", "966"] },
};

/**
 * Rules that depend on the classified address type, plus the caller's policy
 * about which types they will accept.
 *
 * This is the plugin that turns classification from a label into a decision.
 */
export const typeRulesPlugin: Plugin = {
  name: "core:type-rules",

  validate(ctx): Issue[] {
    const issues: Issue[] = [];
    const type = ctx.type ?? "unknown";
    const { acceptTypes, requireCourierDeliverable } = ctx.options;

    if (acceptTypes && !acceptTypes.includes(type)) {
      issues.push(
        issue("TYPE_NOT_ACCEPTED", "error", `${type} addresses are not accepted here.`, undefined, {
          type,
          accepted: acceptTypes.join(","),
        }),
      );
    }

    if (requireCourierDeliverable && !capabilitiesFor(type).courierDeliverable) {
      const code = type === "po_box" ? "PO_BOX_NOT_ACCEPTED" : "TYPE_NOT_ACCEPTED";
      issues.push(
        issue(code, "error", `A ${type} address cannot be delivered to by private couriers.`, undefined, { type }),
      );
    }

    if (type === "military" && ctx.address.countryCode === "US") {
      issues.push(...validateUsMilitary(ctx));
    }

    return issues;
  },

  /**
   * Cap granularity by type. A PO Box has no street or premise no matter how
   * confident the rest of the pipeline is, and reporting `premise` for one
   * would mislead any caller using granularity to gate a shipment.
   */
  granularity(ctx): Granularity | undefined {
    switch (ctx.type) {
      case "po_box":
      case "parcel_locker":
      case "rural_route":
      case "highway_contract":
        return "postal_code";
      case "general_delivery":
        return "locality";
      case "military":
        return "postal_code";
      default:
        return undefined;
    }
  },
};

/**
 * APO/FPO/DPO addresses look like US addresses but obey different rules: the
 * "state" must be AA/AE/AP, and the ZIP has to fall in that region's range.
 * Getting this wrong is a common cause of mail to service members being
 * returned, and no general-purpose US validator catches it.
 */
function validateUsMilitary(ctx: PluginContext): Issue[] {
  const issues: Issue[] = [];
  const admin = (ctx.address.administrativeArea ?? "").trim().toUpperCase();
  const zip = (ctx.address.postalCode ?? "").trim();

  const region = MILITARY_REGIONS[admin];
  if (!region) {
    issues.push(
      issue(
        "MILITARY_ADMIN_AREA_INVALID",
        "error",
        `Military addresses must use AA, AE or AP as the state, not "${admin || "(empty)"}".`,
        "administrativeArea",
        { allowed: "AA,AE,AP" },
      ),
    );
    return issues;
  }

  if (zip) {
    const prefix = zip.slice(0, 3);
    if (!region.zipPrefixes.includes(prefix)) {
      issues.push(
        issue(
          "MILITARY_POSTAL_CODE_INVALID",
          "error",
          `ZIP ${zip} is not in the ${region.name} (${admin}) range.`,
          "postalCode",
          { region: admin, allowedPrefixes: region.zipPrefixes.join(",") },
        ),
      );
    }
  }

  return issues;
}
