import { ChildProcess, spawn } from "child_process";
import fs from "fs";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { IncomingMessage } from "http";
import { pipeline } from "stream/promises";
import http from "https";
import { csvImportCommands, legacyColumns, readCsvColumns } from "./csv-import";
import { computeRange } from "./logic";

const scarfApiToken = process.env.SCARF_API_TOKEN;
if (!scarfApiToken) throw "missing env variable: SCARF_API_TOKEN";

const scarfEntity = process.env.SCARF_ENTITY_NAME;
if (!scarfEntity) throw "missing env variable: SCARF_ENTITY_NAME";

const DB = process.env.PSQL_CONN_STRING;
if (!DB) throw "missing env variable: PSQL_CONN_STRING";

const defaultBackfillDays = parseInt(process.env.BACKFILL_DAYS || "31");

function buildPath(startDate: string, endDate: string) {
  return `/v2/packages/${scarfEntity}/events?start_date=${startDate}&end_date=${endDate}`;
}

async function runPSQL(sql: string | string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Invoke psql directly with arguments to avoid shell parsing issues
    const commands = typeof sql === "string" ? [sql] : sql;
    const child: ChildProcess = spawn(
      "psql",
      [
        DB as string,
        "-XqtA",
        "-v",
        "ON_ERROR_STOP=1",
        "--single-transaction",
        ...commands.flatMap((command) => ["-c", command]),
      ],
      { cwd, shell: false },
    );

    let output = "";
    let errorOutput = "";

    if (child.stdout) {
      child.stdout.on("data", (data: Buffer) => {
        output += data.toString();
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (data: Buffer) => {
        errorOutput += data.toString();
      });
    }

    child.on("error", reject);
    child.on("close", (code: number) => {
      if (code === 0) {
        resolve(output);
      } else {
        const errorMessage = `Command failed with code ${code}: ${errorOutput}`;
        reject(new Error(errorMessage));
      }
    });
  });
}

async function validateManagedSchema() {
  // The import matches rows by ctid, which is only unique within one table.
  const target = "scarf_events_raw";
  try {
    const valid = await runPSQL([
      "SET TRANSACTION READ ONLY",
      `SELECT ${[...legacyColumns, "num_events"].join(", ")}
       FROM ${target} LIMIT 0`,
      `SELECT 'ready'
       FROM pg_catalog.pg_class AS target
       JOIN pg_catalog.pg_attribute AS weight ON weight.attrelid = target.oid
       WHERE target.oid = '${target}'::pg_catalog.regclass
         AND target.relkind = 'r'
         AND NOT EXISTS (
           SELECT 1 FROM pg_catalog.pg_inherits
           WHERE inhparent = target.oid OR inhrelid = target.oid
         )
         AND weight.attname = 'num_events'
         AND NOT weight.attisdropped
         AND weight.atttypid = 'pg_catalog.int8'::pg_catalog.regtype
         AND NOT weight.attnotnull
         AND weight.attgenerated = ''
         AND NOT pg_catalog.row_security_active(target.oid)
         AND pg_catalog.has_database_privilege(current_database(), 'TEMP')
         AND pg_catalog.has_table_privilege(target.oid, 'SELECT')
         AND pg_catalog.has_table_privilege(target.oid, 'INSERT')
         AND pg_catalog.has_table_privilege(target.oid, 'UPDATE')`,
    ]);
    if (valid.trim() !== "ready") {
      throw new Error("Invalid table, num_events column, or role privileges.");
    }
  } catch (error) {
    throw new Error(
      "DBA-managed schema validation failed. Have your DBA apply table-def.sql " +
        "in the destination schema and verify scarf_events_raw is visible on " +
        "the exporter's search_path as a standalone ordinary table without " +
        "inheritance or partitioning, with a nullable bigint num_events column " +
        "that is not generated, and no active row-level security. " +
        "The exporter needs schema USAGE, " +
        "database TEMP, and table-level SELECT, INSERT and UPDATE.",
      { cause: error },
    );
  }
}

async function main() {
  const yesterday = daysAgoString(1);
  const getLastImportedDateSQL = `select cast(max(time) as date) from scarf_events_raw`;

  const managedSchema = process.env.DBA_MANAGED_SCHEMA;
  if (managedSchema === "true") {
    await validateManagedSchema();
  } else if (managedSchema === undefined || managedSchema === "false") {
    await runPSQL(fs.readFileSync("./table-def.sql", "utf8"));
    console.log("table created");
  } else {
    throw new Error("DBA_MANAGED_SCHEMA must be true or false.");
  }
  const lastImportedDate =
    (await runPSQL(getLastImportedDateSQL)).trim() ||
    daysAgoString(defaultBackfillDays);
  const plan = computeRange(lastImportedDate, yesterday);
  if (plan.skip) {
    console.log("Already up to date. Nothing to do.");
    return;
  }
  console.log(`lastImportedDate: ${lastImportedDate}`);
  const directory = await mkdtemp(join(tmpdir(), "scarf-export-"));
  try {
    const csvPath = join(directory, "events.csv");
    console.log("downloading CSV");
    await downloadCSV(buildPath(plan.start, plan.end), csvPath);
    console.log("importing CSV into postgres");
    await runPSQL(csvImportCommands(await readCsvColumns(csvPath)), directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  console.log("done!");
}

async function downloadCSV(path: string, csvPath: string): Promise<void> {
  console.log(`Downloading CSV from ${path}`);
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const request = http.get(
      {
        hostname: "api.scarf.sh",
        path,
        headers: {
          Authorization: `Bearer ${scarfApiToken}`,
          "Content-Type": "application/json",
        },
      },
      resolve,
    );
    request.on("error", reject);
  });
  if (response.statusCode !== 200) {
    response.resume();
    throw new Error(`Scarf export failed with HTTP ${response.statusCode}`);
  }
  await pipeline(response, fs.createWriteStream(csvPath));
}

function daysAgoString(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return formatDate(d);
}

function formatDate(d: Date) {
  let month = "" + (d.getMonth() + 1);
  let day = "" + d.getDate();
  const year = d.getFullYear();

  if (month.length < 2) month = "0" + month;
  if (day.length < 2) day = "0" + day;

  return [year, month, day].join("-");
}

// Shell-free psql invocation handled by runPSQL above

main();
