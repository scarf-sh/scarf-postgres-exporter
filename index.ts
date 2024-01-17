import { ChildProcess, spawn } from "child_process";
import fs from "fs";
import { IncomingMessage } from "http";
import http from "https";

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

async function runCommand(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const process: ChildProcess = spawn("bash", ["-c", command]);

    let output = "";
    let errorOutput = "";

    if (process.stdout) {
      process.stdout.on("data", (data: Buffer) => {
        output += data.toString();
      });
    }

    if (process.stderr) {
      process.stderr.on("data", (data: Buffer) => {
        errorOutput += data.toString();
      });
    }

    process.on("close", (code: number) => {
      if (code === 0) {
        resolve(output);
      } else {
        const errorMessage = `Command failed with code ${code}: ${errorOutput}`;
        reject(new Error(errorMessage));
      }
    });
  });
}

async function main() {
  const tableDef = fs.readFileSync("./table-def.sql");
  const yesterday = daysAgoString(1);
  const getLastImportedDate = formatPSQLBash(
    `select cast(max(time) as date) from scarf_events_raw`,
  );

  await runCommand(formatPSQLBash(tableDef.toString()));
  console.log("table created");
  const lastImportedDate =
    (await runCommand(getLastImportedDate)).trim() ||
    daysAgoString(defaultBackfillDays);
  if (lastImportedDate === yesterday) {
    console.log("All caught up until yesterday. Nothing to do.");
    return;
  }
  console.log(`lastImportedDate: ${lastImportedDate}`);
  console.log(`downloading CSV`);
  await downloadCSV(
    buildPath(dayAfter(lastImportedDate + "T00:00:00"), yesterday),
    yesterday,
  );
  console.log("csv downloaded");
  console.log("importing CSV into postgres");
  const fields = [
    "id",
    "type",
    "package",
    "version",
    "time",
    "referer",
    "user_agent",
    "platform",
    "variables",
    "origin_id",
    "origin_latitude",
    "origin_longitude",
    "origin_country",
    "origin_city",
    "origin_postal",
    "origin_connection_type",
    "origin_company",
    "origin_domain",
    "dnt",
    "confidence",
    "endpoint_id",
    "origin_state"
  ].join(",");
  await runCommand(
    formatPSQLBash(
      `\\copy scarf_events_raw (${fields}) FROM './${yesterday}.csv' WITH (FORMAT CSV, HEADER true)`,
    ),
  );
  console.log("done!");
}

async function downloadCSV(path: string, csvName: string): Promise<void> {
  const file = fs.createWriteStream(`${csvName}.csv`);
  console.log(`Downloading CSV from ${path}`);

  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.scarf.sh",
      path,
      headers: {
        Authorization: `Bearer ${scarfApiToken}`,
        "Content-Type": "application/json",
      },
    };

    http.get(options, function (response: IncomingMessage) {
      if (response.statusCode !== 200) {
        console.log(`Response code: ${response.statusCode}`);
        let data = "";
        response.on("data", (chunk: Buffer) => {
          data += chunk;
        });
        response.on("end", () => {
          console.log(data);
          reject("non 200 response from Scarf. Check your auth token");
        });
      }

      response.pipe(file);

      file.on("error", (err: NodeJS.ErrnoException) => {
        file.close();
        console.error(`Error downloading CSV: ${err}`);
        reject(err);
      });

      file.on("finish", () => {
        file.close();
        console.log("Download Completed");
        resolve();
      });
    });
  });
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

function dayAfter(dString: string): string {
  const d = new Date(dString);
  d.setDate(d.getDate() + 1);
  return formatDate(d);
}

function formatPSQLBash(command: string) {
  return `psql ${DB} -qtAX -c "${command}"`;
}

main();
