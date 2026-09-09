/**
 * RFC 4180 compliant CSV parser and serializer utility.
 */

export function parseCSV(csvText) {
  if (!csvText || typeof csvText !== 'string') return [];
  const text = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = [];
  let currentRow = [];
  let currentVal = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentVal += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentVal.trim());
      currentVal = '';
    } else if (char === '\n' && !inQuotes) {
      currentRow.push(currentVal.trim());
      // Only push non-empty rows
      if (currentRow.some((field) => field !== '')) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentVal = '';
    } else {
      currentVal += char;
    }
  }

  // Handle final row
  if (currentVal || currentRow.length > 0) {
    currentRow.push(currentVal.trim());
    if (currentRow.some((field) => field !== '')) {
      rows.push(currentRow);
    }
  }

  if (rows.length === 0) return [];

  const headers = rows[0].map((h) =>
    h.toLowerCase().replace(/[^a-z0-9]/g, '')
  );

  const objects = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = row[index] !== undefined ? row[index] : '';
    });
    objects.push({ _rowIndex: i + 1, ...obj });
  }

  return objects;
}

export function generateCSV(headers, rows) {
  const escapeCell = (val) => {
    if (val === null || val === undefined) return '""';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return `"${str}"`;
  };

  const headerLine = headers.map((h) => escapeCell(h.label || h.key || h)).join(',');
  const dataLines = rows.map((row) =>
    headers
      .map((h) => {
        const key = h.key || h;
        return escapeCell(row[key]);
      })
      .join(',')
  );

  return [headerLine, ...dataLines].join('\n');
}
