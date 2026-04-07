#!/usr/bin/env node
/**
 * snowflake-discover.js — Schema discovery for LOYVERSE_DATA_LAKE
 * Lists all tables/views and samples data from each.
 */
const snowflake = require('snowflake-sdk');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ACCOUNT = 'ORXEAZX-TC97659';
const USERNAME = 'TARS_SERVICE_USER';
const KEY_PATH = path.join(__dirname, 'snowflake_tars_key.p8');
const DATABASE = 'LOYVERSE_DATA_LAKE';
const SCHEMA = 'PUBLIC';
const WAREHOUSE = 'COMPUTE_WH';
const ROLE = 'DATA_VIEWER';

function readPrivateKey() {
  const keyContent = fs.readFileSync(KEY_PATH, 'utf8');
  const privateKey = crypto.createPrivateKey({ key: keyContent, format: 'pem' });
  return privateKey.export({ type: 'pkcs8', format: 'pem' });
}

function createConnection() {
  return snowflake.createConnection({
    account: ACCOUNT, username: USERNAME, authenticator: 'SNOWFLAKE_JWT',
    privateKey: readPrivateKey(), database: DATABASE, schema: SCHEMA,
    warehouse: WAREHOUSE, role: ROLE,
  });
}

function executeQuery(connection, sql) {
  return new Promise((resolve, reject) => {
    connection.execute({
      sqlText: sql,
      complete: (err, stmt, rows) => {
        if (err) reject(new Error(`Query failed: ${err.message}\nSQL: ${sql}`));
        else resolve(rows);
      }
    });
  });
}

function connectAsync(connection) {
  return new Promise((resolve, reject) => {
    connection.connect((err, conn) => {
      if (err) reject(new Error(`Connection failed: ${err.message}`));
      else resolve(conn);
    });
  });
}

async function main() {
  console.log('=== SNOWFLAKE SCHEMA DISCOVERY ===');
  console.log(`Account: ${ACCOUNT} | DB: ${DATABASE}.${SCHEMA}`);

  const connection = createConnection();
  await connectAsync(connection);
  console.log('Connected!\n');

  // 1. List all databases we can see
  console.log('=== DATABASES ===');
  try {
    const dbs = await executeQuery(connection, 'SHOW DATABASES');
    for (const db of dbs) {
      console.log(`  DB: ${db.name} (${db.kind || 'unknown'})`);
    }
  } catch (e) { console.log('  Cannot list databases:', e.message); }

  // 2. List all schemas in LOYVERSE_DATA_LAKE
  console.log('\n=== SCHEMAS IN LOYVERSE_DATA_LAKE ===');
  try {
    const schemas = await executeQuery(connection, 'SHOW SCHEMAS IN DATABASE LOYVERSE_DATA_LAKE');
    for (const s of schemas) {
      console.log(`  Schema: ${s.name}`);
    }
  } catch (e) { console.log('  Cannot list schemas:', e.message); }

  // 3. List all tables in PUBLIC
  console.log('\n=== TABLES IN LOYVERSE_DATA_LAKE.PUBLIC ===');
  let tables = [];
  try {
    tables = await executeQuery(connection, "SHOW TABLES IN LOYVERSE_DATA_LAKE.PUBLIC");
    for (const t of tables) {
      console.log(`  TABLE: ${t.name} (rows: ${t.rows}, bytes: ${t.bytes})`);
    }
    if (tables.length === 0) console.log('  (no tables found)');
  } catch (e) { console.log('  Cannot list tables:', e.message); }

  // 4. List all views in PUBLIC
  console.log('\n=== VIEWS IN LOYVERSE_DATA_LAKE.PUBLIC ===');
  let views = [];
  try {
    views = await executeQuery(connection, "SHOW VIEWS IN LOYVERSE_DATA_LAKE.PUBLIC");
    for (const v of views) {
      console.log(`  VIEW: ${v.name}`);
    }
    if (views.length === 0) console.log('  (no views found)');
  } catch (e) { console.log('  Cannot list views:', e.message); }

  // 5. For each table/view, show columns and sample 3 rows
  const allObjects = [
    ...tables.map(t => ({ name: t.name, type: 'TABLE' })),
    ...views.map(v => ({ name: v.name, type: 'VIEW' }))
  ];

  for (const obj of allObjects.slice(0, 30)) { // limit to first 30
    console.log(`\n=== ${obj.type}: ${obj.name} ===`);

    // Columns
    try {
      const cols = await executeQuery(connection, `DESCRIBE TABLE "${obj.name}"`);
      console.log('  Columns: ' + cols.map(c => `${c.name} (${c.type})`).join(', '));
    } catch (e) { console.log('  Cannot describe:', e.message); }

    // Sample rows
    try {
      const sample = await executeQuery(connection, `SELECT * FROM "${obj.name}" LIMIT 3`);
      console.log(`  Sample (${sample.length} rows):`);
      for (const row of sample) {
        console.log('    ' + JSON.stringify(row));
      }
    } catch (e) { console.log('  Cannot sample:', e.message); }
  }

  // 6. Also check if there are other schemas with tables
  console.log('\n=== CHECKING ALL SCHEMAS FOR TABLES ===');
  try {
    const schemas = await executeQuery(connection, 'SHOW SCHEMAS IN DATABASE LOYVERSE_DATA_LAKE');
    for (const s of schemas) {
      if (s.name === 'INFORMATION_SCHEMA') continue;
      try {
        const schemaTables = await executeQuery(connection, `SHOW TABLES IN LOYVERSE_DATA_LAKE."${s.name}"`);
        const schemaViews = await executeQuery(connection, `SHOW VIEWS IN LOYVERSE_DATA_LAKE."${s.name}"`);
        if (schemaTables.length > 0 || schemaViews.length > 0) {
          console.log(`\n  Schema: ${s.name}`);
          for (const t of schemaTables) console.log(`    TABLE: ${t.name} (rows: ${t.rows})`);
          for (const v of schemaViews) console.log(`    VIEW: ${v.name}`);
        }
      } catch (e) { /* skip */ }
    }
  } catch (e) { console.log('  Cannot enumerate schemas:', e.message); }

  connection.destroy(() => console.log('\n=== DISCOVERY COMPLETE ==='));
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
