/**
 * CSV generation for the expense export.
 *
 * Two things matter here beyond joining strings with commas:
 *
 * 1. Correct quoting — merchant names contain commas, quotes and newlines.
 * 2. Formula-injection defence — a cell beginning with =, +, -, @ or a control
 *    character is executed as a formula when the file is opened in Excel,
 *    Sheets or Numbers. Since merchant names and notes come from OCR of an
 *    untrusted image, every such cell is neutralised with a leading
 *    apostrophe (the convention spreadsheets understand as "this is text").
 */

const RISKY_PREFIX = /^[=+\-@\t\r]/;

export function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';

  let cell = String(value);

  // Strip control characters that would corrupt the file structure.
  cell = cell.replace(/[\0\v\f]/g, '');

  if (RISKY_PREFIX.test(cell)) {
    cell = `'${cell}`;
  }

  if (/[",\n\r]/.test(cell)) {
    return `"${cell.replace(/"/g, '""')}"`;
  }

  return cell;
}

export function toCsv(headers: readonly string[], rows: readonly (readonly (string | number | null)[])[]): string {
  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((row) => row.map(escapeCsvCell).join(',')),
  ];

  // CRLF is what Excel expects; a trailing newline keeps POSIX tools happy.
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * A UTF-8 BOM. Without it, Excel on Windows renders "£" and "—" as mojibake —
 * a small detail that decides whether the export looks broken to an accountant.
 */
export const UTF8_BOM = '\uFEFF';

/** Builds a safe, descriptive filename: `expenses-2026-09.csv`. */
export function csvFilename(scope: string): string {
  const safe = scope.replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return `expenses-${safe || 'all'}.csv`;
}
