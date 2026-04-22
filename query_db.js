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
    console.log('Connecting to database...');
    await sql.connect(config);
    console.log('Connected successfully!\n');

    // Query 1: Count servers
    console.log('=== Query 1: Server Count ===');
    let result = await sql.query`SELECT COUNT(*) as server_count FROM Servers`;
    console.log(result.recordset);

    // Query 2: List servers
    console.log('\n=== Query 2: Server List ===');
    result = await sql.query`SELECT ServerId, Name, Hostname, Status FROM Servers`;
    console.log(result.recordset);

    // Query 3: Count databases
    console.log('\n=== Query 3: Database Count ===');
    result = await sql.query`SELECT COUNT(*) as database_count FROM Databases`;
    console.log(result.recordset);

    // Query 4: Check Servers table structure
    console.log('\n=== Query 4: Servers Table Info ===');
    result = await sql.query`SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Servers' ORDER BY ORDINAL_POSITION`;
    console.log(result.recordset);

    console.log('\n=== Query 5: Recent Collector Activity ===');
    result = await sql.query`SELECT TOP 5 * FROM CollectorActivity ORDER BY Timestamp DESC`;
    console.log(result.recordset);

    await sql.close();
    console.log('\nDatabase connection closed.');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

runQueries();
