const fs = require('fs');
const path = require('path');
const sql = require('mssql');

function parseEnv(filePath){
  const env = {};
  const content = fs.readFileSync(filePath,'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    env[key] = val;
  }
  return env;
}

function parseConnectionString(cs){
  const parts = cs.split(';').map(p => p.trim()).filter(Boolean);
  const map = {};
  for (const part of parts){
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    map[part.slice(0,idx).trim().toLowerCase()] = part.slice(idx+1).trim();
  }
  const serverPart = map['server'] || map['data source'];
  if (!serverPart) throw new Error('No server in DATABASE_URL');
  const [server, portRaw] = serverPart.split(',');
  return {
    user: map['user id'] || map['uid'] || map['user'],
    password: map['password'] || map['pwd'],
    server,
    port: portRaw ? Number(portRaw) : 1433,
    database: map['database'] || map['initial catalog'],
    options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true }
  };
}

function splitBatches(sqlText){
  const lines = sqlText.replace(/^\uFEFF/, '').split(/\r?\n/);
  const batches = [];
  let current = [];
  for (const line of lines){
    if (/^\s*GO\s*$/i.test(line)) {
      const chunk = current.join('\n').trim();
      if (chunk) batches.push(chunk);
      current = [];
    } else current.push(line);
  }
  const tail = current.join('\n').trim();
  if (tail) batches.push(tail);
  return batches;
}

(async () => {
  const root = process.cwd();
  const env = parseEnv(path.join(root, 'api', '.env'));
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL missing');
  const config = parseConnectionString(env.DATABASE_URL);

  const scripts = [
    path.join(root, 'sql', '001_sqlmonitor_schema.sql'),
    path.join(root, 'sql', '002_alert_dispatch_audit.sql')
  ];

  let pool;
  try {
    pool = await sql.connect(config);
    console.log('Connection: OK');
    for (const script of scripts){
      const text = fs.readFileSync(script, 'utf8');
      const batches = splitBatches(text);
      let n = 0;
      for (const b of batches){ await pool.request().batch(b); n++; }
      console.log(`Script: ${path.basename(script)} => OK (${n} batches)`);
    }

    const q = `SELECT v.name AS TableName, CASE WHEN t.object_id IS NULL THEN 0 ELSE 1 END AS ExistsFlag
               FROM (VALUES ('Thresholds'),('AlertDispatchConfig'),('ServerAccess'),('BackupFailures'),('AgentJobs')) v(name)
               LEFT JOIN sys.tables t ON t.name = v.name
               ORDER BY v.name;`;
    const rs = await pool.request().query(q);
    console.log('Verification:');
    for (const r of rs.recordset) console.log(`${r.TableName}: ${r.ExistsFlag}`);
    const ok = rs.recordset.every(r => r.ExistsFlag === 1);
    console.log(`Overall: ${ok ? 'SUCCESS' : 'FAILURE'}`);
    process.exitCode = ok ? 0 : 2;
  } catch (e) {
    console.error('ExecutionError:', e.message);
    process.exitCode = 1;
  } finally {
    if (pool) await pool.close();
  }
})();
