export type CsvDelimiter = ',' | ';'

export interface CsvTable {
  delimiter: CsvDelimiter
  header: string[]
  rows: string[][]
  /** File line (1-based) on which each row starts; notes may span lines. */
  lines: number[]
}

/** The delimiter used more often in the first line outside quotes; German spreadsheets write ";". */
function detectDelimiter(text: string): CsvDelimiter {
  let commas = 0
  let semicolons = 0
  let quoted = false
  for (const char of text) {
    if (char === '"') quoted = !quoted
    else if (!quoted && (char === '\n' || char === '\r')) break
    else if (!quoted && char === ',') commas += 1
    else if (!quoted && char === ';') semicolons += 1
  }
  return semicolons > commas ? ';' : ','
}

/**
 * Reads CSV as spreadsheets write it (RFC 4180): a field that starts with a quote may hold delimiters,
 * line breaks and doubled quotes; a quote inside an unquoted field (12" vinyl) is just a character.
 * A byte-order mark, blank lines and lines of delimiters only are ignored. Rows keep their field count
 * as found; checking it is the caller's job.
 */
export function parseCsv(input: string): CsvTable {
  const text = input.startsWith('\uFEFF') ? input.slice(1) : input
  const delimiter = detectDelimiter(text)
  const records: { fields: string[]; line: number }[] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let fieldStart = true
  let line = 1
  let rowLine = 1
  const endField = () => {
    row.push(field)
    field = ''
    fieldStart = true
  }
  const endRow = () => {
    endField()
    if (row.some((f) => f.trim() !== '')) records.push({ fields: row, line: rowLine })
    row = []
  }
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!
    if (char === '\n') line += 1
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"'
        i += 1
      } else if (char === '"') quoted = false
      else field += char
      continue
    }
    if (char === '"' && fieldStart) {
      quoted = true
      fieldStart = false
    } else if (char === delimiter) endField()
    else if (char === '\n') {
      endRow()
      rowLine = line
    } else if (char !== '\r') {
      field += char
      fieldStart = false
    }
  }
  if (field !== '' || row.length > 0) endRow()
  const [header, ...rows] = records
  return { delimiter, header: header?.fields ?? [], rows: rows.map((r) => r.fields), lines: rows.map((r) => r.line) }
}

const needsQuotes = /[",;\r\n]/

/** Writes CSV with "," and line feeds; fields are quoted only where needed. */
export function toCsv(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const line = (fields: readonly string[]) => fields.map((f) => (needsQuotes.test(f) ? `"${f.replaceAll('"', '""')}"` : f)).join(',')
  return [header, ...rows].map(line).join('\n') + '\n'
}
