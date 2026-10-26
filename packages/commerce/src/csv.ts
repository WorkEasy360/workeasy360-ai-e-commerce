/**
 * RFC 4180 CSV: quoted fields, doubled quotes, CRLF or LF line ends. Used for
 * product import and export; spreadsheet apps produce and read it.
 */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  // A byte-order mark from Excel is not part of the first header.
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Blank lines carry no data.
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

/**
 * Formula injection guard: a spreadsheet would run a cell starting with
 * = + - @ as a formula, so such text is prefixed with an apostrophe.
 * Plain numbers ("-5") are left alone.
 */
function safeCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) && !/^-?\d+(\.\d+)?$/.test(value) ? `'${value}` : value;
}

function quote(value: string): string {
  const safe = safeCell(value);
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Rows to CSV text with CRLF line ends, as spreadsheet apps expect. */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  return rows.map((r) => r.map((v) => quote(v == null ? "" : String(v))).join(",")).join("\r\n") + "\r\n";
}
