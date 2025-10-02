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

async function runPSQL(sql: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Invoke psql directly with arguments to avoid shell parsing issues
    const child: ChildProcess = spawn("psql", [DB as string, "-qtAX", "-c", sql], {
      shell: false,
    });

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

async function main() {
  const tableDef = fs.readFileSync("./table-def.sql");
  const yesterday = daysAgoString(1);
  const getLastImportedDateSQL = `select cast(max(time) as date) from scarf_events_raw`;

  await runPSQL(tableDef.toString());
  console.log("table created");
  const lastImportedDate =
    (await runPSQL(getLastImportedDateSQL)).trim() ||
    daysAgoString(defaultBackfillDays);
  // If we already imported data for yesterday or later (e.g., today), skip.
  if (lastImportedDate >= yesterday) {
    console.log("Already up to date. Nothing to do.");
    return;
  }
  console.log(`lastImportedDate: ${lastImportedDate}`);
  // Determine date range: from the day after last import up through yesterday
  const startDate = dayAfter(lastImportedDate + "T00:00:00");
  const endDate = yesterday;
  if (new Date(startDate) > new Date(endDate)) {
    console.log(`Start date ${startDate} is after end date ${endDate}. Nothing to do.`);
    return;
  }
  console.log(`downloading CSV`);
  await downloadCSV(buildPath(startDate, endDate), yesterday);
  console.log("csv downloaded");
  console.log("importing CSV into postgres");
  const fields = [
    "id",
    "type",
    "package",
    "pixel",
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
    "origin_state",
    "mtc_quota_exceeded"
  ].join(",");
  await runPSQL(
    `\\copy scarf_events_raw (${fields}) FROM './${yesterday}.csv' WITH (FORMAT CSV, HEADER true)`,
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

// Shell-free psql invocation handled by runPSQL above

main();
