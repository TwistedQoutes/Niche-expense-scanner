import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { TENANT_MODELS } from '@/lib/db/tenant';
import { buildArchive, cellText, omit, toCsv } from '@/lib/workspace/archive';
import { EXPORTED_MODELS } from '@/lib/workspace/export';
import { namesMatch } from '@/lib/validation/workspace';

const BOM = '﻿';
const body = (csv: string) => csv.replace(BOM, '');

describe('the export covers every tenant table', () => {
  it('names exactly the models the tenant client guards', () => {
    // A new tenant model without an export table is data the owner was told
    // they could take and cannot. This fails the day that happens.
    expect([...EXPORTED_MODELS].sort()).toEqual([...TENANT_MODELS].sort());
  });
});

describe('a cell as text', () => {
  it('writes dates as UTC ISO 8601', () => {
    expect(cellText(new Date('2026-09-28T14:05:00Z'))).toBe('2026-09-28T14:05:00.000Z');
  });

  it('writes nested values as JSON, and nothing for null', () => {
    expect(cellText({ a: 1 })).toBe('{"a":1}');
    expect(cellText(null)).toBe('');
    expect(cellText(undefined)).toBe('');
  });
});

describe('CSV', () => {
  it('starts with a byte-order mark so Excel reads UTF-8', () => {
    expect(toCsv([{ name: 'José' }]).startsWith(BOM)).toBe(true);
  });

  it('quotes commas, quotes and line breaks per RFC 4180', () => {
    const csv = body(toCsv([{ note: 'Gate code 4411, "dog is friendly"\nback lawn only' }]));
    expect(csv).toBe('note\r\n"Gate code 4411, ""dog is friendly""\nback lawn only"\r\n');
  });

  it('gives a column to a field that only some rows have', () => {
    const csv = body(toCsv([{ id: 'a' }, { id: 'b', gateCode: '9' }]));
    expect(csv).toBe('id,gateCode\r\na,\r\nb,9\r\n');
  });

  it('defuses a formula a stranger typed into a lead', () => {
    // A lead description arrives from anyone with a phone. In a spreadsheet a
    // leading "=" is code, not text.
    const csv = body(
      toCsv([
        { description: '=HYPERLINK("http://evil.test","Click")' },
        { description: '+1 555 0100' },
        { description: '@SUM(A1)' },
        { description: '-2+3' },
      ]),
    );
    const cells = csv.trim().split('\r\n').slice(1);
    expect(cells[0]).toBe(`"'=HYPERLINK(""http://evil.test"",""Click"")"`);
    expect(cells[1]).toBe("'+1 555 0100");
    expect(cells[2]).toBe("'@SUM(A1)");
    expect(cells[3]).toBe("'-2+3");
  });

  it('leaves a negative number a number', () => {
    // A margin of -24 must still sum in the owner's spreadsheet.
    expect(body(toCsv([{ marginBps: -2400 }]))).toBe('marginBps\r\n-2400\r\n');
  });
});

describe('secrets', () => {
  it('are dropped wherever they appear', () => {
    expect(omit({ id: 'x', tokenHash: 'h', token: 't', email: 'a@b.test' }, ['tokenHash', 'token'])).toEqual({
      id: 'x',
      email: 'a@b.test',
    });
  });
});

describe('the archive', () => {
  const bytes = buildArchive({
    businessName: 'Green Acres Lawn',
    exportedAt: new Date('2026-09-28T12:00:00Z'),
    business: { id: 'org_1', name: 'Green Acres Lawn' },
    tables: [
      { name: 'customers', description: 'the people you work for', rows: [{ id: 'c1', firstName: 'Dana' }] },
      { name: 'leads', description: 'every enquiry', rows: [] },
    ],
  });
  const files = unzipSync(bytes);

  it('holds a README, the business, one CSV per table, and the full JSON', () => {
    expect(Object.keys(files).sort()).toEqual(
      ['README.txt', 'business.csv', 'customers.csv', 'data.json', 'leads.csv'].sort(),
    );
  });

  it('says in the README how to read money and what is missing', () => {
    const readme = strFromU8(files['README.txt']!);
    expect(readme).toContain('Green Acres Lawn');
    expect(readme).toContain('12500 means $125.00');
    expect(readme).toContain('customers.csv');
    expect(readme).toMatch(/Photo files/);
  });

  it('writes the same records to data.json', () => {
    const json = JSON.parse(strFromU8(files['data.json']!)) as Record<string, unknown>;
    expect(json.customers).toEqual([{ id: 'c1', firstName: 'Dana' }]);
    expect(json.leads).toEqual([]);
    expect(json.business).toEqual({ id: 'org_1', name: 'Green Acres Lawn' });
  });

  it('writes an empty table as a file, not as nothing', () => {
    // A missing leads.csv reads as "the export broke"; an empty one reads as
    // "there were no leads".
    expect(files['leads.csv']).toBeDefined();
  });
});

describe('confirming a deletion by name', () => {
  it('forgives case and spacing', () => {
    expect(namesMatch('  green   acres LAWN ', 'Green Acres Lawn')).toBe(true);
  });

  it('refuses a near miss', () => {
    expect(namesMatch('Green Acre Lawn', 'Green Acres Lawn')).toBe(false);
    expect(namesMatch('', 'Green Acres Lawn')).toBe(false);
  });
});
