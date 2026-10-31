/* The phone and wide layouts' media queries, with no DOM: the web build reads them too (server/webBuild writes them
   into the custom media the library's styles use, as Conduit's vite.config.js does). */

/** The widest a phone layout goes. */
export const MOBILE_LAYOUT_BREAKPOINT_PX = 760;

/** Query for a primary pointer with touch input and no hover. */
export const TOUCH_ONLY_QUERY = "(hover: none) and (pointer: coarse)";

/** Phone chrome needs both a narrow viewport and a phone-like primary pointer. */
export const PHONE_LAYOUT_QUERY = `(max-width: ${MOBILE_LAYOUT_BREAKPOINT_PX}px) and ${TOUCH_ONLY_QUERY}`;

/** The desktop shell is the complement used by Conduit's supported pointer types. */
export const NON_PHONE_LAYOUT_QUERY = `(min-width: ${MOBILE_LAYOUT_BREAKPOINT_PX + 1}px), (hover: hover), (pointer: fine), (pointer: none)`;
