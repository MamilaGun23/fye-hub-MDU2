'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '../..');
const PRIVATE = path.join(ROOT, '.demo-seed');
function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function privatePath(name) {
  const target = path.resolve(PRIVATE, name);
  if (!target.startsWith(PRIVATE + path.sep)) throw new Error('Output must stay inside .demo-seed/.');
  return target;
}
function save(name, value) {
  const target = privatePath(name);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temp = `${target}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  // Windows indexing/antivirus can briefly hold the target between checkpoints.
  // Retain the atomic replacement and retry the sharing violation in place.
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(temp, target); break; }
    catch (error) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt >= 9) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(200, 20 * (attempt + 1)));
    }
  }
  return target;
}
function read(name) { return JSON.parse(fs.readFileSync(privatePath(name), 'utf8')); }
function parseCSV(text) {
  const rows = []; let row = [], value = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { value += '"'; i++; }
      else if (quoted || value === '') quoted = !quoted;
      else throw new Error('Invalid CSV quoting.');
    } else if (char === ',' && !quoted) { row.push(value); value = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(value); if (row.some(Boolean)) rows.push(row); row = []; value = '';
    } else value += char;
  }
  if (quoted) throw new Error('Unclosed CSV quote.');
  row.push(value); if (row.some(Boolean)) rows.push(row);
  return rows;
}
function importAudit(filename) {
  const text = fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, '').trim();
  let data;
  if (text.startsWith('{') || text.startsWith('[')) data = JSON.parse(text);
  else {
    const rows = parseCSV(text);
    const col = rows[0]?.indexOf('audit');
    if (col < 0 || rows.length !== 2) throw new Error('Export must contain one audit row.');
    data = JSON.parse(rows[1][col]);
  }
  if (Array.isArray(data)) {
    if (data.length !== 1) throw new Error('Export must contain one audit row.');
    data = data[0];
  }
  if (data.audit) data = typeof data.audit === 'string' ? JSON.parse(data.audit) : data.audit;
  return data;
}
function csv(rows) {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]);
  const cell = value => {
    let text = String(value ?? '');
    // Prevent spreadsheet formula execution in downloaded/locally opened previews.
    if (/^\s*[=+@\-]|^[\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  return '\uFEFF' + [keys.map(cell).join(','), ...rows.map(row => keys.map(key => cell(row[key])).join(','))].join('\r\n') + '\r\n';
}
module.exports = { ROOT, PRIVATE, digest, privatePath, save, read, parseCSV, importAudit, csv };
