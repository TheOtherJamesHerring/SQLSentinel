const sql = require('mssql');

const config = {
  server: 'MTCG-SQL-DEV',
  port: 1433,
  database: 'SQLMonitorDB',
  user: 'sqlmonitor_api',
  password: 'B00tlegger2026!',
  options: {
    encrypt: true,
    trustServerCertificate: true,
    connectTimeout: 15000
  }
};

async function runQueries() {
  try {
    await sql.connect(config);

    // Check what tables exist
    console.log('=== Database Tables ===');
    let result = await sql.query`SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME`;
    console.log(result.recordset);

    // Check servers with all metrics
    console.log('\n=== Full Server Records ===');
    result = await sql.query`SELECT TOP 10 * FROM Servers ORDER BY CreatedDate DESC`;
    console.log(JSON.stringify(result.recordset, null, 2));

    // Check databases
    console.log('\n=== Database Records (first 5) ===');
    result = await sql.query`SELECT TOP 5 * FROM Databases`;
    console.log(JSON.stringify(result.recordset, null, 2));

    // Check for any activity/audit logs
    console.log('\n=== Available Audit/Log Tables ===');
    result = await sql.query`SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME LIKE '%Audit%' OR TABLE_NAME LIKE '%Log%' OR TABLE_NAME LIKE '%Activity%'`;
    console.log(result.recordset);

    await sql.close();
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

runQueries();
