import assert from "assert";
import { execFileSync } from "child_process";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { csvImportCommands, readCsvColumns } from "../src/csv-import";

const legacyHeader =
  "id,type,package,pixel,version,time,referer,user_agent,platform,variables,origin_id,origin_latitude,origin_longitude,origin_country,origin_city,origin_postal,origin_connection_type,origin_company,origin_domain,dnt,confidence,endpoint_id,origin_state,mtc_quota_exceeded";
const sonatype = [
  "shared",
  "sonatype",
  "axon-messaging",
  "",
  "",
  "2026-11-11T10:00:00Z",
];
const download = [
  "shared",
  "file_download",
  "other",
  "",
  "",
  "2026-11-11T10:00:00Z",
];
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
      "INSERT INTO scarf_events_raw (id,type,package,time) VALUES ('shared','sonatype','axon-messaging','2026-11-11 10:00:00')",
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
    console.log("Postgres CSV import checks passed.");
  } finally {
    try {
      psql(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

testImport().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
