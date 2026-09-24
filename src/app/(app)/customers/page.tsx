import type { Metadata } from 'next';
import Link from 'next/link';

import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { requireAuth } from '@/lib/auth/context';
import { listCustomerRows } from '@/lib/customers/repository';
import { formatRelative } from '@/lib/dates';
import { formatCentsCompact } from '@/lib/money';

export const metadata: Metadata = { title: 'Customers' };
export const dynamic = 'force-dynamic';

export default async function CustomersPage() {
  const auth = await requireAuth();
  const currency = auth.organization.currency;

  const customers = await listCustomerRows(auth.db);

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">Customers</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Everyone you have worked for, and what they are worth.
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200/80 dark:bg-slate-900 dark:ring-slate-800">
        {customers.length === 0 ? (
          <EmptyState
            title="No customers yet"
            description="Convert a won lead and it will appear here with its whole history attached."
            action={
              <Link
                href="/leads"
                className="text-brand-700 dark:text-brand-400 text-sm font-medium"
              >
                Go to the pipeline
              </Link>
            }
          />
        ) : (
          // Scrolls horizontally on a phone rather than crushing six columns
          // into 380px.
          <div className="overflow-x-auto">
            <table className="w-full min-w-[42rem] text-sm">
              <thead className="border-b border-slate-100 text-left text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">Name</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Contact</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Jobs</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Lifetime value</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Last service</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Next due</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {customers.map((customer) => {
                  return (
                    <tr key={customer.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                      <td className="px-4 py-3">
                        <Link
                          href={`/customers/${customer.id}`}
                          className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                        >
                          {[customer.firstName, customer.lastName].filter(Boolean).join(' ')}
                        </Link>
                        {customer.company ? (
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {customer.company}
                          </p>
                        ) : null}
                      </td>

                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                        {customer.phone ?? customer.email ?? '—'}
                      </td>

                      <td className="tabular px-4 py-3 text-slate-600 dark:text-slate-400">
                        {customer.jobsCompleted}
                      </td>

                      <td className="tabular px-4 py-3 text-right font-medium text-slate-800 dark:text-slate-200">
                        {formatCentsCompact(customer.lifetimeValueCents, currency)}
                      </td>

                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                        {customer.lastServicedAt ? formatRelative(customer.lastServicedAt) : '—'}
                      </td>

                      <td className="px-4 py-3">
                        {customer.nextServiceDueAt ? (
                          customer.serviceDueNow ? (
                            <Badge tone="urgent">Due now</Badge>
                          ) : (
                            <span className="text-slate-600 dark:text-slate-400">
                              {formatRelative(customer.nextServiceDueAt)}
                            </span>
                          )
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
