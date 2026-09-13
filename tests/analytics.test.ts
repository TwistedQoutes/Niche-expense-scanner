import { describe, expect, it } from 'vitest';

import { chartThemeCss, ACCENT, ORDINAL_RAMP } from '@/components/charts/palette';
import { recentMonthKeys } from '@/lib/dates';

/**
 * The figures on an analytics screen are read as facts and acted on. A wrong one
 * does not throw — it just quietly tells an owner to spend money on the wrong
 * channel. These are the parts of that arithmetic that can be pinned down without
 * a database; the rest is covered live.
 */

describe('the months a trend covers', () => {
  it('ends with the current month and runs backwards', () => {
    const keys = recentMonthKeys(12, new Date('2026-09-13T12:00:00Z'));

    expect(keys).toHaveLength(12);
    expect(keys.at(-1)).toBe('2026-09');
    expect(keys[0]).toBe('2025-10');
  });

  it('crosses a year boundary without repeating or skipping a month', () => {
    const keys = recentMonthKeys(6, new Date('2026-02-15T12:00:00Z'));

    expect(keys).toEqual(['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02']);
    expect(new Set(keys).size).toBe(6);
  });

  it('is a contiguous run, so a quiet month cannot be silently dropped', () => {
    // A trend that omits the months with no activity makes a seasonal business
    // look like it grew when it only stopped reporting.
    const keys = recentMonthKeys(12, new Date('2026-09-13T12:00:00Z'));

    for (let index = 1; index < keys.length; index += 1) {
      const [prevYear, prevMonth] = keys[index - 1]!.split('-').map(Number) as [number, number];
      const [year, month] = keys[index]!.split('-').map(Number) as [number, number];

      const monthsApart = (year - prevYear) * 12 + (month - prevMonth);
      expect(monthsApart).toBe(1);
    }
  });
});

describe('the chart palette', () => {
  it('has a separately chosen step for each mode', () => {
    // Dark is not an automatic flip of light: a step that reads well on white is
    // either invisible or glaring on near-black.
    expect(ACCENT.light).not.toBe(ACCENT.dark);
    expect(ORDINAL_RAMP.light).not.toEqual(ORDINAL_RAMP.dark);
  });

  it('gives the funnel one hue that only gets darker', () => {
    // An ordinal ramp, not a categorical palette: funnel stages are ordered, and
    // five hues would spend the identity channel on what the bar lengths say.
    for (const ramp of [ORDINAL_RAMP.light, ORDINAL_RAMP.dark]) {
      expect(ramp).toHaveLength(5);
      expect(new Set(ramp).size).toBe(5);

      const luminance = ramp.map((hex) => {
        const [r, g, b] = [1, 3, 5].map((offset) =>
          parseInt(hex.slice(offset, offset + 2), 16) / 255,
        ) as [number, number, number];
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      });

      for (let index = 1; index < luminance.length; index += 1) {
        expect(luminance[index]!).toBeLessThan(luminance[index - 1]!);
      }
    }
  });

  it('declares dark under both the OS query and the theme attribute', () => {
    // The media query follows the operating system; the attribute follows the
    // viewer's own toggle, and the toggle has to win in both directions.
    const css = chartThemeCss('viz-test');

    expect(css).toContain('.viz-test{');
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain(':root:not([data-theme="light"]) .viz-test');
    expect(css).toContain(':root[data-theme="dark"] .viz-test');
  });

  it('puts the light values first, so an explicit light theme is not overridden', () => {
    const css = chartThemeCss('viz-test');

    expect(css.indexOf('.viz-test{')).toBeLessThan(css.indexOf('@media'));
    expect(css.indexOf('@media')).toBeLessThan(css.indexOf(':root[data-theme="dark"]'));
  });

  it('exposes every ramp step as its own custom property', () => {
    const css = chartThemeCss('viz-test');

    for (let step = 1; step <= 5; step += 1) {
      expect(css).toContain(`--viz-step-${step}:`);
    }
    expect(css).toContain('--viz-accent:');
    expect(css).toContain('--viz-surface:');
  });

  it('scopes the styles to the given class, so two charts cannot fight', () => {
    const css = chartThemeCss('viz-one');

    expect(css).not.toContain('viz-two');
    expect(css).not.toMatch(/:root\{/);
  });
});
