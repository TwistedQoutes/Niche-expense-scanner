import { Card } from '@/components/ui/Card';

/**
 * What the billing screen shows inside the native apps.
 *
 * App Store Review Guideline 3.1.1: an app that does not sell through Apple's
 * in-app purchase may not show prices, may not present a plan as something to
 * buy, and may not link out to a page where it can be bought. A reviewer opens
 * every screen looking for exactly that, and a link to jobflowai.dev/billing is
 * the thing they are looking for.
 *
 * So this page states the one fact a crew member actually needs — their plan is
 * managed somewhere else, by their boss — and stops. No price, no plan
 * comparison, no link, no "visit our website" instruction. The address is not
 * written here either: a reviewer reads "go to jobflowai.dev" as a purchase
 * instruction, and the owner already knows where their own account lives.
 */
export function BillingUnavailable({ organizationName }: { organizationName: string }) {
  return (
    <Card className="px-5 py-6">
      <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
        Plan and payment
      </h2>
      <p className="mt-2 max-w-prose text-sm text-slate-600 dark:text-slate-400">
        The plan for {organizationName} is managed from a desktop browser, not from the app.
        Everything else in JobFlow works here as normal.
      </p>
      <p className="mt-3 max-w-prose text-sm text-slate-600 dark:text-slate-400">
        If you need a change to the plan, ask whoever owns the workspace.
      </p>
    </Card>
  );
}
