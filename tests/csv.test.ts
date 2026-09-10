import { describe, expect, it } from 'vitest';

import { csvFilename, escapeCsvCell, toCsv } from '@/lib/csv';

describe('escapeCsvCell', () => {
  it('leaves plain values untouched', () => {
    expect(escapeCsvCell('Kingpin Tattoo Supply')).toBe('Kingpin Tattoo Supply');
    expect(escapeCsvCell(42)).toBe('42');
  });

  it('renders null and undefined as empty cells', () => {
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(undefined)).toBe('');
  });

  it('quotes and escapes commas, quotes and newlines', () => {
    expect(escapeCsvCell('Needles, ink')).toBe('"Needles, ink"');
    expect(escapeCsvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(escapeCsvCell('line one\nline two')).toBe('"line one\nline two"');
  });

  it('neutralises spreadsheet formula injection', () => {
    // The dangerous part is the leading character, which spreadsheets execute.
    expect(escapeCsvCell('=1+1')).toBe("'=1+1");
    expect(escapeCsvCell('=HYPERLINK("http://evil.test","click")')).toBe(
      '"\'=HYPERLINK(""http://evil.test"",""click"")"',
    );
    expect(escapeCsvCell('+44 7700 900000')).toBe("'+44 7700 900000");
    expect(escapeCsvCell('-cmd')).toBe("'-cmd");
    expect(escapeCsvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('strips control characters that would corrupt the file', () => {
    expect(escapeCsvCell('ink\0jet')).toBe('inkjet');
  });
});

describe('toCsv', () => {
  it('writes a CRLF-delimited document with a header row', () => {
    const csv = toCsv(['Date', 'Merchant'], [['2026-09-01', 'TatSoul']]);
    expect(csv).toBe('Date,Merchant\r\n2026-09-01,TatSoul\r\n');
  });

  it('handles an empty result set', () => {
    expect(toCsv(['Date'], [])).toBe('Date\r\n');
  });
});

describe('csvFilename', () => {
  it('builds a safe filename from the scope', () => {
    expect(csvFilename('2026-09')).toBe('expenses-2026-09.csv');
  });

  it('strips path traversal and header-injection attempts', () => {
    expect(csvFilename('../../etc/passwd')).toBe('expenses-etc-passwd.csv');
    expect(csvFilename('a"; drop')).toBe('expenses-a-drop.csv');
  });
});
