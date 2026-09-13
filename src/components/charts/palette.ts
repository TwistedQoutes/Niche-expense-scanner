/**
 * Chart colour, as roles rather than hex.
 *
 * The values are not a matter of taste: they were run through the data-viz
 * validator against this app's own surfaces (white in light, slate-900 in dark)
 * and these are the steps that pass. Re-running is the way to change them —
 * eyeballing "colourblind-safe" is how a chart becomes unreadable for one reader
 * in twelve.
 *
 * Dark is *selected*, not an automatic flip: the same emerald ramp, re-stepped for
 * a dark surface, because a step that reads well on white is either too light to
 * see or too saturated to look at on near-black.
 *
 * Exposed as CSS custom properties on a wrapper so a chart body is written against
 * roles, and the light/dark swap happens in one place.
 */

/**
 * The single-series accent.
 *
 * Light `#059669` is 4.5:1 on white; dark `#0ba573` sits inside the dark
 * lightness band (OKLCH L 0.48–0.67) at over 3:1 on slate-900. Most charts here
 * have one series, and a one-series chart needs no legend — the title names it.
 */
export const ACCENT = { light: '#059669', dark: '#0ba573' } as const;

/**
 * The ordinal ramp, for stages that have a real order — the funnel.
 *
 * One hue, light to dark, five steps with a visible lightness gap between each.
 * Not a categorical palette: funnel stages are ordered, and giving them five
 * different hues would spend the identity channel on information the bar lengths
 * already carry.
 *
 * The light ramp starts at the lightest step that still clears 2:1 on white, and
 * the dark ramp stops at the darkest that clears 2:1 on slate-900 — a stage that
 * fades into the card is a stage nobody reads.
 */
export const ORDINAL_RAMP = {
  light: ['#10b981', '#059669', '#047857', '#065f46', '#022c22'],
  dark: ['#6ee7b7', '#34d399', '#10b981', '#059669', '#047857'],
} as const;

/** Chart chrome. Recessive by design — the data is the only loud thing. */
export const CHROME = {
  grid: { light: '#e2e8f0', dark: '#1e293b' },
  axis: { light: '#cbd5e1', dark: '#334155' },
  surface: { light: '#ffffff', dark: '#0f172a' },
} as const;

/**
 * The CSS custom properties a chart wrapper declares.
 *
 * Emitted as a `<style>` block scoped to one generated class, which is what lets
 * a server-rendered SVG be theme-aware without any JavaScript: the same markup,
 * two sets of values, chosen by the media query and the theme attribute.
 */
export function chartThemeCss(scope: string): string {
  const light = [
    `--viz-accent:${ACCENT.light}`,
    `--viz-grid:${CHROME.grid.light}`,
    `--viz-axis:${CHROME.axis.light}`,
    `--viz-surface:${CHROME.surface.light}`,
    ...ORDINAL_RAMP.light.map((hex, index) => `--viz-step-${index + 1}:${hex}`),
  ].join(';');

  const dark = [
    `--viz-accent:${ACCENT.dark}`,
    `--viz-grid:${CHROME.grid.dark}`,
    `--viz-axis:${CHROME.axis.dark}`,
    `--viz-surface:${CHROME.surface.dark}`,
    ...ORDINAL_RAMP.dark.map((hex, index) => `--viz-step-${index + 1}:${hex}`),
  ].join(';');

  /*
   * Both scopes, in this order, for the reason the reference palette gives: the
   * media query follows the operating system, the attribute follows the viewer's
   * own toggle, and the toggle has to win in both directions. The `:not()` guard
   * is what lets an explicit light choice beat an OS set to dark.
   */
  return [
    `.${scope}{${light}}`,
    `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .${scope}{${dark}}}`,
    `:root[data-theme="dark"] .${scope}{${dark}}`,
  ].join('');
}
