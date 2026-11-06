import { DatabaseSync } from 'node:sqlite';
import { lstatSync } from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';
import { adminQueries, projectAdminSource, readySource, unavailableSource } from './admin-data.mjs';

// This worker owns no application connection and can perform only fixed SELECTs
// against the exact Store-owned file. Its lifetime remains tracked through exit.
let db;
try {
  const { source, days, limitPerDay } = workerData;
  const matches = () => {
    const stat = lstatSync(source.path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.dev !== source.device || stat.ino !== source.inode ||
        (process.getuid && stat.uid !== process.getuid())) throw new Error();
  };
  matches(); db = new DatabaseSync(source.path, { readOnly: true }); matches();
  db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=75; BEGIN');
  const queries = adminQueries('sqlite', days);
  for (const name of ['tasks', 'usage', 'executions', 'events']) {
    try {
      const query = queries[name], statement = db.prepare(query.text);
      statement.setReadBigInts(true);
      const rows = statement.all(...query.values), data = projectAdminSource(name, rows, days, limitPerDay);
      parentPort.postMessage({ name, source: readySource(name, data, new Date().toISOString()) });
    } catch { parentPort.postMessage({ name, source: unavailableSource(name) }); }
  }
  db.exec('ROLLBACK');
} catch { /* Only fixed unavailable envelopes leave a failed worker. */ }
finally { try { db?.close(); } catch {} parentPort.close(); }
