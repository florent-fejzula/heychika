import { crc32, dateSerial, ref, sheetNames, workbook } from './xlsx';

// Reads back the zip the way a spreadsheet app does: from the central directory at the end.
function unzip(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files = new Map<string, string>();
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    expect(crc32(data)).toBe(crc);
    files.set(name, decoder.decode(data));
    at += 46 + nameLength;
  }
  return files;
}

describe('xlsx', () => {
  it('checksums like zip does', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('names cells the way Excel does', () => {
    expect([ref(0, 1), ref(25, 2), ref(26, 3), ref(27, 4), ref(701, 5), ref(702, 6)]).toEqual(['A1', 'Z2', 'AA3', 'AB4', 'ZZ5', 'AAA6']);
  });

  it('turns dates into Excel day numbers', () => {
    expect(dateSerial('1900-03-01')).toBe(61);
    expect(dateSerial('2026-10-02')).toBe(46297);
    expect(dateSerial('2 Oct')).toBeNull();
  });

  it('keeps sheet names within Excel’s rules', () => {
    expect(sheetNames(['Sales: by design?', 'Sales  by design ', 'x'.repeat(40), ''])).toEqual([
      'Sales  by design',
      'Sales  by design (2)',
      'x'.repeat(31),
      'Sheet4',
    ]);
  });

  it('writes a workbook with a sheet per table, numbers as numbers and text made safe', () => {
    const files = unzip(
      workbook([
        {
          name: 'Sales',
          columns: [{ header: 'Design' }, { header: 'Items', kind: 'int' }, { header: 'Paid on', kind: 'date' }],
          rows: [
            ['Fustan <ë> & "ç"', 3, '2026-10-02'],
            [' padded ', null, null],
          ],
          totals: ['Total', 3, null],
        },
        { name: 'Second', columns: [{ header: 'A' }], rows: [] },
      ]),
    );

    expect([...files.keys()]).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
    ]);
    expect(files.get('xl/workbook.xml')).toContain('<sheet name="Sales" sheetId="1" r:id="rId1"/>');
    expect(files.get('[Content_Types].xml')).toContain('/xl/worksheets/sheet2.xml');

    const sheet = files.get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain('<c r="A1" s="1" t="inlineStr"><is><t>Design</t></is></c>');
    expect(sheet).toContain('<t>Fustan &lt;ë&gt; &amp; &quot;ç&quot;</t>');
    expect(sheet).toContain('<c r="B2" s="2"><v>3</v></c>');
    expect(sheet).toContain('<c r="C2" s="4"><v>46297</v></c>');
    expect(sheet).toContain('<t xml:space="preserve"> padded </t>');
    expect(sheet).not.toContain('r="B3"'); // empty cells are left out
    expect(sheet).toContain('<c r="B4" s="6"><v>3</v></c>'); // totals in bold
    expect(sheet).toContain('state="frozen"');
  });
});
