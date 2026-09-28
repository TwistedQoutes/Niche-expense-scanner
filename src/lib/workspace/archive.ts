import { strToU8, zipSync, type Zippable } from 'fflate';

/**
 * Turning a workspace's rows into a download a business owner can open.
 *
 * Pure: no database, no request. `export.ts` reads the rows; this decides how
 * they are written down, which is the part worth testing on its own.
 */

export type Row = Record<string, unknown>;

export type Table = {
  /** File name without extension, e.g. "customers". */
  name: string;
  /** What the table is, in one line, for the README. */
  description: string;
  rows: Row[];
};

/**
 * A cell as text.
 *
 * Dates as ISO 8601 in UTC, which every spreadsheet parses and which cannot be
 * misread as day-first or month-first. Nested values (settings, automation
 * config, metadata) as compact JSON rather than "[object Object]".
 */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/*
 * Formula injection.
 *
 * Plenty of what is in here was typed by strangers: a lead's description, a text
 * a customer sent, a name on a web form. A cell that starts with "=" is a
 * formula to Excel and Google Sheets, so "=HYPERLINK(…)" from a stranger becomes
 * a live link in the owner's spreadsheet, and older Excel will run far worse.
 * The OWASP remedy is a leading apostrophe, which spreadsheets treat as "this is
 * text" and do not display.
 *
 * Only strings are guarded. A negative number is a number, and "-24" for a
 * margin must stay a value the owner can sum.
 */
const FORMULA_TRIGGERS = /^[=+\-@\t\r]/;

function guardFormula(value: unknown, text: string): string {
  return typeof value === 'string' && FORMULA_TRIGGERS.test(text) ? `'${text}` : text;
}

function quoteCsv(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * RFC 4180 CSV, with a byte-order mark.
 *
 * The BOM is for Excel, which otherwise opens a UTF-8 file as the local legacy
 * code page and turns "José" into "JosÃ©". Other tools ignore it. Columns are
 * the union of every row's keys in first-seen order, so a field that is only
 * set on some rows still gets a column.
 */
export function toCsv(rows: Row[]): string {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }

  const lines = [columns.map(quoteCsv).join(',')];
  for (const row of rows) {
    lines.push(
      columns.map((column) => quoteCsv(guardFormula(row[column], cellText(row[column])))).join(','),
    );
  }

  return `﻿${lines.join('\r\n')}\r\n`;
}

/** Drops keys that must never leave the database, whatever table they are in. */
export function omit<T extends Row>(row: T, keys: readonly string[]): Row {
  const copy: Row = { ...row };
  for (const key of keys) delete copy[key];
  return copy;
}

function readme(input: { businessName: string; exportedAt: Date; tables: Table[] }): string {
  const list = input.tables
    .map((table) => `  ${`${table.name}.csv`.padEnd(26)} ${table.rows.length.toString().padStart(6)} rows — ${table.description}`)
    .join('\n');

  return `JobFlow AI — everything in ${input.businessName}
Exported ${input.exportedAt.toISOString()}

Each .csv opens in Excel, Numbers or Google Sheets. data.json holds the same
records in one file, for moving them into other software.

What is in here
${list}

How to read it
  - Money is in cents: 12500 means $125.00. Columns ending "Cents" are money.
  - Percentages ending "Bps" are basis points: 3000 means 30%.
  - Times are UTC, written like 2026-09-28T14:05:00.000Z.
  - Rows refer to each other by id: a lead's customerId is the id of a row in
    customers.csv.

What is not in here
  - Photo files. photos.csv lists every photo with a downloadPath; open that
    path on your JobFlow address while signed in to download the image.
  - Passwords and sign-in tokens. They are stored only as one-way hashes, and a
    copy of a hash is of no use to anyone but an attacker.
`;
}

/** The zip, as bytes. */
export function buildArchive(input: {
  businessName: string;
  exportedAt: Date;
  business: Row;
  tables: Table[];
}): Uint8Array {
  const files: Zippable = {
    'README.txt': strToU8(readme(input)),
    'business.csv': strToU8(toCsv([input.business])),
    'data.json': strToU8(
      JSON.stringify(
        {
          exportedAt: input.exportedAt.toISOString(),
          business: input.business,
          ...Object.fromEntries(input.tables.map((table) => [table.name, table.rows])),
        },
        null,
        2,
      ),
    ),
  };

  for (const table of input.tables) {
    files[`${table.name}.csv`] = strToU8(toCsv(table.rows));
  }

  // Level 6: text compresses about tenfold, and the higher levels buy little
  // for a lot more time inside a request.
  return zipSync(files, { level: 6 });
}
