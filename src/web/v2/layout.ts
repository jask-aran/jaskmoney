/* Layout: the phone and wide layouts, the touch-only test, and pixels for a length in the unit. vite.config.js turns
   the queries into the CSS custom media (--conduit-phone-layout, --conduit-wide-layout) the library's styles use. */

import { TOUCH_ONLY_QUERY } from "./queries";
export * from "./queries";

/** Whether the primary pointer has touch input and no hover. */
export const touchOnly = () => typeof matchMedia === "function" && matchMedia(TOUCH_ONLY_QUERY).matches;

// Measured once and kept until the window or the Interface size changes.
let unit: number | undefined;
if (typeof window !== "undefined") for (const change of ["resize", "conduit:ui-scale"]) addEventListener(change, () => { unit = undefined; });
/** Pixels for a length in the unit, at the root (the chrome's region). */
export function unitPx(units: number) {
  if (unit === undefined) {
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;width:var(--u-space)";
    document.body.append(probe);
    unit = probe.getBoundingClientRect().width || 16;
    probe.remove();
  }
  return units * unit;
}
