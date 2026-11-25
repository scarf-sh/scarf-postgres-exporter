import assert from "assert";
import { execFileSync, spawnSync } from "child_process";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { csvImportCommands, readCsvColumns } from "../src/csv-import";

const legacyHeader =
  "id,type,package,pixel,version,time,referer,user_agent,platform,variables,origin_id,origin_latitude,origin_longitude,origin_country,origin_city,origin_postal,origin_connection_type,origin_company,origin_domain,dnt,confidence,endpoint_id,origin_state,mtc_quota_exceeded";
const eventTime = new Date(Date.now() - 7 * 86_400_000).toISOString();
const sonatype = ["shared", "sonatype", "axon-messaging", "", "", eventTime];
const download = ["shared", "file_download", "other", "", "", eventTime];
const row = (fields: string[]) => [...fields, ...Array(18).fill("")].join(",");

async function testImport() {
  const database = process.env.TEST_POSTGRES_URL;
  assert(
    database,
    "TEST_POSTGRES_URL must point to a disposable test database",
  );
  const directory = await mkdtemp(join(tmpdir(), "scarf-import-test-"));
  const csv = join(directory, "events.csv");
  const schema = `scarf_import_test_${process.pid}`;
  const role = `scarf_export_test_${process.pid}`;
  const password = "scarf-test-only";
  const restricted = new URL(database);
  restricted.username = role;
  restricted.password = password;
  restricted.searchParams.set("options", `-csearch_path=${schema}`);
  const mock = join(directory, "csv-response.cjs");
  const runExporter = (connection: string, managed?: string) => {
    const env = { ...process.env };
    delete env.DBA_MANAGED_SCHEMA;
    return spawnSync(process.execPath, ["-r", mock, "dist/src/index.js"], {
      encoding: "utf8",
      env: {
        ...env,
        SCARF_ENTITY_NAME: "fixture",
        SCARF_API_TOKEN: "fixture-token",
        PSQL_CONN_STRING: connection,
        ...(managed === undefined ? {} : { DBA_MANAGED_SCHEMA: managed }),
      },
    });
  };
  const installMock = (body?: string) =>
    writeFile(
      mock,
      `const { Readable } = require("node:stream");
       require("node:https").get = (options, callback) => {
         if (${body === undefined}) throw new Error("unexpected download");
         require("node:assert/strict").equal(options.hostname, "api.scarf.sh");
         require("node:assert/strict").ok(options.path.startsWith("/v2/packages/fixture/events?"));
         const response = Readable.from([${JSON.stringify(body ?? "")}]);
         response.statusCode = 200;
         process.nextTick(() => callback(response));
         return { on() {} };
       };`,
    );
  const expectManagedError = (pattern: RegExp) => {
    const result = runExporter(restricted.toString(), "true");
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, pattern);
    assert.doesNotMatch(result.stderr, /unexpected download/);
    assert.doesNotMatch(result.stdout, /downloading CSV/);
  };
  const expectExport = (connection: string, managed?: string) => {
    const result = runExporter(connection, managed);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /done!/);
  };
  const psql = (...commands: string[]) =>
    execFileSync(
      "psql",
      [
        database,
        "-XqtA",
        "-v",
        "ON_ERROR_STOP=1",
        "--single-transaction",
        "-c",
        `SET search_path TO ${schema}`,
        ...commands.flatMap((command) => ["-c", command]),
      ],
      { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  const importCsv = async (content: string) => {
    await writeFile(csv, content);
    psql(...csvImportCommands(await readCsvColumns(csv)));
  };

  try {
    const tableDefinition = await readFile("table-def.sql", "utf8");
    const baseDefinition = tableDefinition.split("-- Legacy CSV")[0];
    assert(baseDefinition);
    const summary =
      "SELECT count(*), count(num_events), sum(num_events) FROM scarf_events_raw";
    psql(`CREATE SCHEMA ${schema}`, tableDefinition);
    await importCsv(
      `${legacyHeader},ip_address,num_events\r\n${row(
        sonatype,
      )},192.0.2.1,7\r\n`,
    );
    assert.equal(psql(summary), "1|1|7");

    psql("DROP TABLE scarf_events_raw", baseDefinition);
    psql(
      `INSERT INTO scarf_events_raw (id,type,package,time) VALUES ('shared','sonatype','axon-messaging','${eventTime}')`,
    );
    psql(tableDefinition);
    psql(
      "ALTER TABLE scarf_events_raw ADD COLUMN customer_label text NOT NULL DEFAULT 'imported'",
    );
    assert.equal(psql(summary), "1|0|");
    const legacy = `${legacyHeader}\r\n${row(sonatype)}\r\n`;
    await importCsv(legacy);
    assert.equal(psql(summary), "1|0|");

    // The header can reorder known columns. The duplicate legacy match is
    // enriched once, and another source record sharing its ID stays distinct.
    const weighted = `num_events,${legacyHeader}\r\n7,${row(
      sonatype,
    )}\r\n7,${row(sonatype)}\r\n1,${row(download)}\r\n`;
    await importCsv(weighted);
    await importCsv(weighted);
    await importCsv(legacy);
    assert.equal(psql(summary), "2|2|8");

    const mismatched = `${legacyHeader},num_events\r\n${row(
      sonatype,
    )},7\r\n${row(sonatype)},8\r\n`;
    await assert.rejects(importCsv(mismatched), /conflicting weights/);
    await assert.rejects(
      importCsv(`${legacyHeader},unknown\n`),
      /Unexpected Scarf events CSV header/,
    );
    await assert.rejects(
      importCsv(`${legacyHeader},num_events\n${row(download)},oops\n`),
      /invalid input syntax/,
    );
    assert.equal(psql(summary), "2|2|8");
    // Exercise the normal compiled exporter with real psql as a login that
    // cannot create/alter the destination. Only the Scarf HTTPS boundary is fake.
    psql(
      "DROP TABLE scarf_events_raw",
      `CREATE ROLE ${role} LOGIN PASSWORD '${password}'`,
      `DO $$ BEGIN EXECUTE format('GRANT CONNECT, TEMP ON DATABASE %I TO %I', current_database(), '${role}'); END $$`,
      `GRANT USAGE ON SCHEMA ${schema} TO ${role}`,
    );
    await installMock();
    expectManagedError(/DBA-managed schema validation failed/);
    psql(
      baseDefinition,
      `GRANT SELECT, INSERT, UPDATE ON scarf_events_raw TO ${role}`,
    );
    expectManagedError(/nullable bigint num_events/);
    psql("ALTER TABLE scarf_events_raw ADD COLUMN num_events integer");
    expectManagedError(/nullable bigint num_events/);
    psql(
      "ALTER TABLE scarf_events_raw ALTER COLUMN num_events TYPE bigint",
      "ALTER TABLE scarf_events_raw ALTER COLUMN num_events SET NOT NULL",
    );
    expectManagedError(/nullable bigint num_events/);
    psql(
      "ALTER TABLE scarf_events_raw DROP COLUMN num_events",
      "ALTER TABLE scarf_events_raw ADD COLUMN num_events bigint GENERATED ALWAYS AS (1::bigint) STORED",
    );
    expectManagedError(/not generated/);
    psql(
      "ALTER TABLE scarf_events_raw DROP COLUMN num_events",
      "ALTER TABLE scarf_events_raw ADD COLUMN num_events bigint",
    );
    psql("ALTER TABLE scarf_events_raw ENABLE ROW LEVEL SECURITY");
    expectManagedError(/no active row-level security/);
    psql(
      "ALTER TABLE scarf_events_raw DISABLE ROW LEVEL SECURITY",
      `REVOKE UPDATE ON scarf_events_raw FROM ${role}`,
      `GRANT UPDATE (num_events) ON scarf_events_raw TO ${role}`,
    );
    expectManagedError(/table-level SELECT, INSERT and UPDATE/);
    psql(`GRANT UPDATE ON scarf_events_raw TO ${role}`);
    psql("CREATE TABLE inheritance_child () INHERITS (scarf_events_raw)");
    expectManagedError(
      /standalone ordinary table without inheritance or partitioning/,
    );
    psql(
      "DROP TABLE inheritance_child",
      "CREATE TABLE inheritance_parent (LIKE scarf_events_raw)",
      "ALTER TABLE scarf_events_raw INHERIT inheritance_parent",
    );
    expectManagedError(
      /standalone ordinary table without inheritance or partitioning/,
    );
    psql(
      "ALTER TABLE scarf_events_raw NO INHERIT inheritance_parent",
      "DROP TABLE inheritance_parent",
      "ALTER TABLE scarf_events_raw RENAME TO standalone_target",
      "CREATE TABLE scarf_events_raw (LIKE standalone_target) PARTITION BY HASH (id)",
      "CREATE TABLE partition_child PARTITION OF scarf_events_raw FOR VALUES WITH (MODULUS 1, REMAINDER 0)",
      `GRANT SELECT, INSERT, UPDATE ON scarf_events_raw TO ${role}`,
    );
    expectManagedError(
      /standalone ordinary table without inheritance or partitioning/,
    );
    psql(
      "DROP TABLE scarf_events_raw",
      "ALTER TABLE standalone_target RENAME TO scarf_events_raw",
    );
    assert.equal(
      psql(`SELECT has_schema_privilege('${role}', '${schema}', 'CREATE'),
        has_table_privilege('${role}', 'scarf_events_raw', 'DELETE'),
        has_table_privilege('${role}', 'scarf_events_raw', 'TRUNCATE'),
        (SELECT tableowner = '${role}' FROM pg_tables
         WHERE schemaname = '${schema}' AND tablename = 'scarf_events_raw')`),
      "f|f|f|f",
    );
    psql(
      `INSERT INTO scarf_events_raw (id,type,package,time) VALUES ('shared','sonatype','axon-messaging','${eventTime}')`,
    );
    // Replay the same synthetic CSVs despite advancing the checkpoint so the
    // CLI must handle legacy data and then reconcile those exact source rows.
    await installMock(legacy);
    expectExport(restricted.toString(), "true");
    assert.equal(psql(summary), "1|0|");
    await installMock(weighted);
    expectExport(restricted.toString(), "true");
    expectExport(restricted.toString(), "true");
    assert.equal(psql(summary), "2|2|8");
    await installMock(legacy);
    expectExport(restricted.toString(), "true");
    assert.equal(psql(summary), "2|2|8");

    // Unset mode still migrates a legacy schema as the owner on normal startup.
    psql("DROP TABLE scarf_events_raw", baseDefinition);
    const owner = new URL(database);
    owner.searchParams.set("options", `-csearch_path=${schema}`);
    await installMock(weighted);
    expectExport(owner.toString());
    assert.equal(psql(summary), "2|2|8");

    // Different partitions can store unrelated events at the same ctid.
    psql(
      "DROP TABLE scarf_events_raw",
      baseDefinition.trimEnd().replace(/;$/, " PARTITION BY LIST (type);"),
      "CREATE TABLE sonatype_events PARTITION OF scarf_events_raw FOR VALUES IN ('sonatype')",
      "CREATE TABLE download_events PARTITION OF scarf_events_raw FOR VALUES IN ('file_download')",
      `INSERT INTO scarf_events_raw (id,type,package,time) VALUES
        ('shared','sonatype','axon-messaging','${eventTime}'),
        ('shared','file_download','other','${eventTime}')`,
    );
    assert.equal(
      psql("SELECT count(DISTINCT ctid) FROM scarf_events_raw"),
      "1",
    );
    await installMock(`${legacyHeader},num_events\n${row(sonatype)},7\n`);
    expectExport(owner.toString());
    expectExport(owner.toString());
    assert.equal(
      psql("SELECT type, num_events FROM scarf_events_raw ORDER BY type"),
      "file_download|\nsonatype|7",
    );
    console.log("Postgres CSV import checks passed.");
  } finally {
    try {
      psql(
        `DROP SCHEMA IF EXISTS ${schema} CASCADE`,
        `DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN DROP OWNED BY ${role}; DROP ROLE ${role}; END IF; END $$`,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

testImport().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
