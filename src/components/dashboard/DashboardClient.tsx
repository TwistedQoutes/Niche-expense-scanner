'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { CategoryBreakdown } from '@/components/dashboard/CategoryBreakdown';
import { ExpenseTable } from '@/components/dashboard/ExpenseTable';
import { ExportButton } from '@/components/dashboard/ExportButton';
import { MonthFilter } from '@/components/dashboard/MonthFilter';
import { SummaryCards } from '@/components/dashboard/SummaryCards';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { ApiError, apiRequest } from '@/lib/api-client';
import type { CategoryId } from '@/lib/categories/taxonomy';
import { formatMonthLabel } from '@/lib/dates';
import type { ExpenseDto, ExpenseListResponse } from '@/types';

/**
 * The dashboard.
 *
 * The first month is rendered on the server (see the page component) so the
 * artist sees their data immediately; changing month, re-categorising and
 * deleting are handled here without a full navigation.
 */
export function DashboardClient({
  initialData,
  initialMonth,
  availableMonths,
}: {
  initialData: ExpenseListResponse;
  initialMonth: string;
  availableMonths: string[];
}) {
  const [month, setMonth] = useState(initialMonth);
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  /**
   * The in-flight month request. Tapping through months quickly starts several
   * fetches; aborting the previous one means a slow earlier response can never
   * overwrite the month now on screen.
   */
  const inFlight = useRef<AbortController | null>(null);

  const load = useCallback(async (targetMonth: string) => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    setLoading(true);
    setError(null);

    try {
      const response = await apiRequest<ExpenseListResponse>(
        `/api/expenses?month=${encodeURIComponent(targetMonth)}`,
        { signal: controller.signal },
      );
      setData(response);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      setError(caught instanceof ApiError ? caught.message : 'Could not load expenses.');
    } finally {
      // A superseded request must not clear the spinner belonging to its replacement.
      if (inFlight.current === controller) {
        inFlight.current = null;
        setLoading(false);
      }
    }
  }, []);

  // Fetching is a response to an event (a month tap), not a side effect of
  // rendering — so the only thing left for an effect is cancelling on unmount.
  useEffect(() => () => inFlight.current?.abort(), []);

  function handleMonthChange(nextMonth: string) {
    if (nextMonth === month) return;
    setMonth(nextMonth);
    void load(nextMonth);
  }

  async function handleRecategorise(id: string, category: CategoryId) {
    setBusyId(id);
    setError(null);

    // Optimistic: the change is instant, and rolled back if the server refuses.
    const previous = data;
    setData((current) => ({
      ...current,
      expenses: current.expenses.map((expense) =>
        expense.id === id ? { ...expense, category, categorySource: 'manual', categoryConfidence: 1 } : expense,
      ),
    }));

    try {
      await apiRequest<{ expense: ExpenseDto }>(`/api/expenses/${id}`, {
        method: 'PATCH',
        body: { category },
      });
      // Reload so the summary and breakdown reflect the new category.
      await load(month);
    } catch (caught) {
      setData(previous);
      setError(caught instanceof ApiError ? caught.message : 'Could not update that expense.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: string) {
    const expense = data.expenses.find((candidate) => candidate.id === id);
    if (!expense) return;

    // A native confirm is not pretty, but it is unambiguous and cannot be
    // missed on a phone — the right trade for a destructive, unrecoverable action.
    if (!window.confirm(`Delete the ${expense.merchant} expense? This cannot be undone.`)) return;

    setBusyId(id);
    setError(null);

    try {
      await apiRequest(`/api/expenses/${id}`, { method: 'DELETE' });
      await load(month);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not delete that expense.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleLoadMore() {
    if (!data.nextCursor) return;
    setLoadingMore(true);
    try {
      const response = await apiRequest<ExpenseListResponse>(
        `/api/expenses?month=${encodeURIComponent(month)}&cursor=${encodeURIComponent(data.nextCursor)}`,
      );
      setData((current) => ({
        ...response,
        expenses: [...current.expenses, ...response.expenses],
      }));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load more expenses.');
    } finally {
      setLoadingMore(false);
    }
  }

  const isEmpty = data.expenses.length === 0;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Expenses</h1>
          <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">{formatMonthLabel(month)}</p>
        </div>
        <Link href="/scan" className="shrink-0">
          <Button size="sm">+ Scan</Button>
        </Link>
      </div>

      <MonthFilter value={month} available={availableMonths} onChange={handleMonthChange} />

      {error ? <Alert tone="error">{error}</Alert> : null}

      {loading ? (
        <Card className="flex items-center justify-center gap-3 px-4 py-12 text-sm text-zinc-500 dark:text-zinc-400">
          <Spinner className="size-4" label="Loading expenses" />
          Loading {formatMonthLabel(month)}…
        </Card>
      ) : isEmpty ? (
        <Card className="px-6 py-12 text-center">
          <p className="font-medium">Nothing logged for {formatMonthLabel(month)}</p>
          <p className="mx-auto mt-1 max-w-xs text-sm text-zinc-500 dark:text-zinc-400">
            Scan a supplier receipt and it&rsquo;ll appear here, categorised.
          </p>
          <Link href="/scan" className="mt-5 inline-block">
            <Button size="lg">Scan a receipt</Button>
          </Link>
        </Card>
      ) : (
        <>
          <SummaryCards summary={data.summary} />

          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">
              {data.summary.count} receipt{data.summary.count === 1 ? '' : 's'}
            </h2>
            <ExportButton month={month} />
          </div>

          <ExpenseTable
            expenses={data.expenses}
            onRecategorise={handleRecategorise}
            onDelete={handleDelete}
            busyId={busyId}
          />

          {data.nextCursor ? (
            <Button variant="secondary" fullWidth loading={loadingMore} onClick={handleLoadMore}>
              Load more
            </Button>
          ) : null}

          <CategoryBreakdown summary={data.summary} />

          <p className="pt-2 text-xs text-zinc-400 dark:text-zinc-600">
            The export maps every category to its Schedule C line. General guidance, not tax advice.
          </p>
        </>
      )}
    </div>
  );
}
