import { chartThemeCss } from '@/components/charts/palette';
import type { FunnelStage } from '@/lib/analytics/reports';

/**
 * The lead-to-job funnel, as horizontal bars on an ordinal ramp.
 *
 * Horizontal because the stage names are words, not dates — a column chart would
 * either rotate them or truncate them. The ramp is one hue getting darker down the
 * funnel, which is the right encoding for stages that have a real order; five
 * different hues would spend the identity channel on information the bar lengths
 * already carry, and would imply the stages are unrelated categories.
 *
 * The conversion figure between stages is the number an owner acts on, so it is
 * labelled directly rather than left to a tooltip.
 */
export function FunnelChart({ stages }: { stages: FunnelStage[] }) {
  const scope = 'viz-funnel';
  const top = stages[0]?.count ?? 0;

  if (top === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
        No leads yet, so there is no funnel to show.
      </p>
    );
  }

  return (
    <div className={`${scope} space-y-2.5`}>
      <style>{chartThemeCss(scope)}</style>

      {stages.map((stage, index) => {
        const share = Math.max(stage.shareOfTopPercent, stage.count > 0 ? 2 : 0);

        return (
          <div key={stage.key} className="space-y-1">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="flex items-center gap-2">
                {/*
                  Identity comes from a swatch beside the text, never from
                  colouring the text: these ramp steps are unreadable as type.
                */}
                <span
                  aria-hidden="true"
                  className="inline-block size-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: `var(--viz-step-${index + 1})` }}
                />
                <span className="text-slate-700 dark:text-slate-300">{stage.label}</span>
              </span>

              <span className="flex items-baseline gap-2">
                <span className="tabular font-medium text-slate-900 dark:text-slate-100">
                  {stage.count}
                </span>
                {stage.conversionFromPreviousPercent !== null ? (
                  <span className="tabular text-xs text-slate-500 dark:text-slate-400">
                    {stage.conversionFromPreviousPercent}% of above
                  </span>
                ) : null}
              </span>
            </div>

            {/* A 20px bar with a 4px rounded data-end, square against the baseline. */}
            <div className="h-5 w-full overflow-hidden rounded-sm bg-slate-100 dark:bg-slate-800">
              <div
                className="h-full rounded-r-[4px]"
                style={{
                  width: `${share}%`,
                  backgroundColor: `var(--viz-step-${index + 1})`,
                }}
                role="img"
                aria-label={`${stage.label}: ${stage.count}, ${stage.shareOfTopPercent}% of leads`}
                title={`${stage.label}: ${stage.count} (${stage.shareOfTopPercent}% of all leads)`}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
