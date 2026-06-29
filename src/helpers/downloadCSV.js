export function downloadCSV(filename, columns, rows, formatters = {}) {
  const headers = columns.map(([, label]) => label);
  const csvRows = rows.map((row) =>
    columns.map(([key]) => {
      const value = row[key];
      const formatted = formatters[key] ? formatters[key](value) : String(value || '').replace(/_/g, ' ');
      return `"${String(formatted).replace(/"/g, '""')}"`;
    }).join(',')
  );
  const csv = [headers, ...csvRows].map((row) =>
    Array.isArray(row) ? row.join(',') : row
  ).join('\n');

  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
