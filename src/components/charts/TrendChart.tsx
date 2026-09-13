import { chartThemeCss } from '@/components/charts/palette';
import { formatMonthShort, type MonthKey } from '@/lib/dates';

/**
 * A single series over months, as an area chart.
 *
 * One series, so there is no legend — the heading says what is plotted, and a
 * one-swatch legend box would only restate it.
 *
 * **The axis labels are HTML, not SVG text.** Text inside a viewBox scales with
 * the viewBox, so an 11px label on a 720-unit plot renders at about 5px once the
 * card is phone width — technically present, actually unreadable. Keeping the SVG
 * for the plot and the type in HTML gives the same size at every width.
 *
 * Server-rendered with no JavaScript. Hover is carried by `<title>` on each
 * point's hit target, which the browser shows natively; that is less than a full
 * crosshair, and the table beneath the chart is what actually guarantees every
 * value is reachable — by a screen reader, in a printout, and for anyone the
 * colours do not work for.
 */
export function TrendChart({
  points,
  formatValue,
  label,
}: {
  points: { month: MonthKey; value: number }[];
  /**
   * How to write a value. Passed in rather than assumed, because this chart plots
   * money on one screen and counts on another — and a count rendered through a
   * currency formatter is a lie told in the axis labels.
   */
  formatValue: (value: number) => string;
  /** What is being plotted, for the accessible summary. */
  label: string;
}) {
  const scope = 'viz-trend';

  if (points.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
        Nothing recorded yet.
      </p>
    );
  }

  // The plot only — the axes live outside it, so these units are pure geometry.
  const width = 720;
  const height = 200;

  const values = points.map((point) => point.value);
  const peak = Math.max(...values, 1);

  /*
   * The scale tops out at a round number above the peak rather than at the peak
   * itself, so the ticks are numbers a person recognises and the busiest month is
   * not jammed against the top edge.
   */
  const magnitude = 10 ** Math.floor(Math.log10(peak));
  let ceiling = Math.ceil(peak / magnitude) * magnitude;

  /*
   * Kept even so the midpoint tick is a whole number. With a peak of 3 the ceiling
   * would otherwise be 3, putting a gridline at 1.5 under a label reading "2" — the
   * label and the line it belongs to must agree, or the axis is lying about where
   * the values sit.
   */
  if (ceiling % 2 !== 0) ceiling += magnitude;

  const x = (index: number) =>
    points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
  const y = (value: number) => height - (value / ceiling) * height;

  const line = points.map((point, index) => `${x(index)},${y(point.value)}`).join(' ');
  const area = `0,${height} ${line} ${width},${height}`;

  const last = points.at(-1)!;
  const lastX = x(points.length - 1);
  const lastY = y(last.value);

  /*
   * Every other month, counted back from the newest — so the current month, which
   * is the one carrying the direct label, always gets an axis label. Counting
   * forwards from the oldest drops it on an even-length series, which is exactly
   * the month a reader is looking for.
   */
  const labelled = (index: number) => (points.length - 1 - index) % 2 === 0;

  return (
    <div className={scope}>
      <style>{chartThemeCss(scope)}</style>

      <div className="flex gap-2">
        {/* The y axis, in real text at a real size. */}
        <div className="relative w-14 shrink-0" style={{ height: '180px' }} aria-hidden="true">
          {[1, 0.5, 0].map((fraction) => (
            <span
              key={fraction}
              className="tabular absolute right-0 -translate-y-1/2 text-[11px] text-slate-500 dark:text-slate-400"
              style={{ top: `${(1 - fraction) * 100}%` }}
            >
              {formatValue(ceiling * fraction)}
            </span>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            className="w-full"
            style={{ height: '180px' }}
            role="img"
            aria-label={`${label} by month. Latest: ${formatValue(last.value)} in ${formatMonthShort(last.month)}.`}
          >
            {/*
              Hairline gridlines. `vectorEffect` keeps them 1px however the
              non-uniform scale stretches the box — without it they thicken and
              stop being recessive.
            */}
            {[0, 0.5, 1].map((fraction) => (
              <line
                key={fraction}
                x1={0}
                x2={width}
                y1={height * fraction}
                y2={height * fraction}
                stroke={fraction === 1 ? 'var(--viz-axis)' : 'var(--viz-grid)'}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {/* The area is a wash, not a block: the line carries the shape. */}
            <polygon points={area} fill="var(--viz-accent)" opacity={0.1} />

            <polyline
              points={line}
              fill="none"
              stroke="var(--viz-accent)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />

            {points.map((point, index) => (
              /* A generous transparent hit target — the visible dot is too small to hover. */
              <rect
                key={point.month}
                x={x(index) - width / (points.length * 2)}
                y={0}
                width={width / points.length}
                height={height}
                fill="transparent"
              >
                <title>{`${formatMonthShort(point.month)}: ${formatValue(point.value)}`}</title>
              </rect>
            ))}
          </svg>

          {/*
            The end marker and its label sit outside the stretched SVG, so the dot
            stays round and the type stays the size it was written at.
          */}
          <div className="relative" style={{ marginTop: '-180px', height: '180px' }} aria-hidden="true">
            <span
              className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2"
              style={{
                left: `${(lastX / width) * 100}%`,
                top: `${(lastY / height) * 100}%`,
                backgroundColor: 'var(--viz-accent)',
                // A surface ring, so the marker stays legible where it crosses the line.
                ['--tw-ring-color' as string]: 'var(--viz-surface)',
              }}
            />
            <span
              className="tabular absolute -translate-x-full text-[12px] font-semibold text-slate-900 dark:text-slate-100"
              style={{
                left: `calc(${(lastX / width) * 100}% - 8px)`,
                top: `max(0px, calc(${(lastY / height) * 100}% - 22px))`,
              }}
            >
              {formatValue(last.value)}
            </span>
          </div>

          {/* The x axis, also real text. */}
          <div className="mt-1.5 flex justify-between">
            {points.map((point, index) => (
              <span
                key={point.month}
                className="text-[11px] text-slate-500 dark:text-slate-400"
                aria-hidden="true"
              >
                {labelled(index) ? formatMonthShort(point.month) : ' '}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
