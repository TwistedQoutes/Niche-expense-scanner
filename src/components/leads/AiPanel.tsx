'use client';

import { Urgency } from '@prisma/client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { ApiError, apiRequest } from '@/lib/api-client';

export type AiQualification = {
  score: number | null;
  summary: string | null;
  intent: string | null;
  urgency: Urgency | null;
  recommendedAction: string | null;
  suggestedResponse: string | null;
  qualifiedAt: string | null;
  model: string | null;
};

const URGENCY_TONES: Record<Urgency, BadgeTone> = {
  LOW: 'neutral',
  MEDIUM: 'info',
  HIGH: 'urgent',
  EMERGENCY: 'danger',
};

/**
 * What the AI thought, and the draft reply it wrote.
 *
 * The draft is presented as something to read and edit, never as something to
 * send: there is a copy button and no send button. That is not a missing feature —
 * the model's output was shaped partly by text a stranger typed into a public
 * form, and the person whose business name goes on the reply should see it first.
 */
export function AiPanel({
  leadId,
  qualification,
  aiConfigured,
}: {
  leadId: string;
  qualification: AiQualification;
  aiConfigured: boolean;
}) {
  const router = useRouter();
  const toast = useToast();

  const [running, setRunning] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  async function run() {
    if (running) return;
    setRunning(true);
    setWarnings([]);

    try {
      const result = await apiRequest<{ warnings: string[] }>('/api/ai/qualify', {
        method: 'POST',
        body: { leadId },
      });

      setWarnings(result.warnings);
      toast.success('Lead qualified.');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not qualify that lead.');
    } finally {
      setRunning(false);
    }
  }

  async function copyDraft() {
    if (!qualification.suggestedResponse) return;

    try {
      await navigator.clipboard.writeText(qualification.suggestedResponse);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy. Select the text and copy it by hand.');
    }
  }

  if (!aiConfigured) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        AI qualification is not switched on for this workspace. Everything else works without it —
        add an OpenAI key to turn it on.
      </p>
    );
  }

  const hasResult = qualification.qualifiedAt !== null;

  return (
    <div className="space-y-4">
      {hasResult ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {qualification.score !== null ? (
              <span className="tabular text-2xl font-semibold text-slate-900 dark:text-slate-50">
                {qualification.score}
                <span className="text-sm font-normal text-slate-500 dark:text-slate-400">/100</span>
              </span>
            ) : null}

            {qualification.urgency ? (
              <Badge tone={URGENCY_TONES[qualification.urgency]}>
                {qualification.urgency.toLowerCase()} urgency
              </Badge>
            ) : null}
          </div>

          {qualification.summary ? (
            <Field label="The job" value={qualification.summary} />
          ) : null}
          {qualification.intent ? <Field label="What they want" value={qualification.intent} /> : null}
          {qualification.recommendedAction ? (
            <Field label="Do this next" value={qualification.recommendedAction} />
          ) : null}

          {qualification.suggestedResponse ? (
            <div>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Draft reply — read it before you send it
              </p>
              <p className="mt-1 rounded-xl bg-slate-50 p-3 text-sm whitespace-pre-wrap text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {qualification.suggestedResponse}
              </p>
              <Button
                size="sm"
                variant="secondary"
                className="mt-2"
                onClick={() => void copyDraft()}
              >
                {copied ? 'Copied' : 'Copy draft'}
              </Button>
            </div>
          ) : null}

          {warnings.length > 0 ? (
            <div className="space-y-2">
              {warnings.map((warning) => (
                <Alert key={warning} tone="warning">
                  {warning}
                </Alert>
              ))}
            </div>
          ) : null}

          <p className="text-xs text-slate-400 dark:text-slate-500">
            A score is a starting point, not a decision. {qualification.model ?? 'AI'}-generated.
          </p>
        </>
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Not scored yet. New leads are qualified automatically a moment after they arrive.
        </p>
      )}

      <Button variant="secondary" fullWidth loading={running} onClick={() => void run()}>
        {hasResult ? 'Re-run with the latest detail' : 'Qualify now'}
      </Button>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm text-slate-800 dark:text-slate-200">{value}</p>
    </div>
  );
}
