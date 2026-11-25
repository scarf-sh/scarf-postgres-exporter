import { createReadStream } from "fs";
import { createInterface } from "readline";

export const legacyColumns = [
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
  "mtc_quota_exceeded",
];

export async function readCsvColumns(path: string): Promise<string[]> {
  const input = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const header of lines) {
      const columns = header.split(",");
      const expected = legacyColumns.concat(
        columns.filter(
          (column) => column === "ip_address" || column === "num_events",
        ),
      );
      if (
        new Set(columns).size !== columns.length ||
        expected.length !== columns.length ||
        !expected.every((column) => columns.includes(column))
      ) {
        throw new Error("Unexpected Scarf events CSV header");
      }
      return columns;
    }
    throw new Error("Scarf events CSV is missing its header");
  } finally {
    lines.close();
    input.destroy();
  }
}

export function csvImportCommands(columns: string[]): string[] {
  // The artifact and time disambiguate the same request ID across exports.
  const key = ["id", "type", "package", "pixel", "time"];
  const joinKey = [
    "existing.id = incoming.id",
    ...key
      .slice(1)
      .map(
        (column) =>
          `existing.${column} IS NOT DISTINCT FROM incoming.${column}`,
      ),
  ].join(" AND ");
  const stored = [...legacyColumns, "num_events"].join(", ");
  const eventKey = key.join(", ");
  const incomingKey = key.map((column) => `incoming.${column}`).join(", ");
  return [
    `CREATE TEMP TABLE scarf_events_incoming ON COMMIT DROP AS
      SELECT ${stored}, NULL::text AS ip_address FROM scarf_events_raw WITH NO DATA`,
    "ALTER TABLE scarf_events_incoming ALTER COLUMN id SET NOT NULL",
    `\\copy scarf_events_incoming (${columns.join(
      ", ",
    )}) FROM './events.csv' WITH (FORMAT CSV, HEADER true)`,
    `DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM scarf_events_incoming
        GROUP BY ${eventKey} HAVING min(num_events) <> max(num_events)
      ) THEN
        RAISE EXCEPTION 'Scarf CSV has conflicting weights for the same event';
      END IF;
    END $$`,
    `CREATE TEMP TABLE scarf_events_batch ON COMMIT DROP AS
      SELECT DISTINCT ON (${eventKey}) ${stored}
      FROM scarf_events_incoming
      ORDER BY ${eventKey}, num_events NULLS LAST, ctid`,
    "ANALYZE scarf_events_batch",
    // Serialize the check and write across concurrent exporter processes.
    "LOCK TABLE scarf_events_raw IN SHARE ROW EXCLUSIVE MODE",
    // Tuple locations are unique only within each physical table.
    `UPDATE scarf_events_raw AS target SET num_events = matched.num_events
      FROM (
        SELECT DISTINCT ON (${incomingKey})
          incoming.num_events, existing.tableoid, existing.ctid
        FROM scarf_events_batch AS incoming
        JOIN scarf_events_raw AS existing ON ${joinKey}
        WHERE incoming.num_events IS NOT NULL
        ORDER BY ${incomingKey},
          existing.num_events IS NULL, existing.tableoid, existing.ctid
      ) AS matched
      WHERE target.tableoid = matched.tableoid AND target.ctid = matched.ctid
        AND target.num_events IS DISTINCT FROM matched.num_events`,
    `INSERT INTO scarf_events_raw (${stored})
      SELECT ${stored} FROM scarf_events_batch AS incoming
      WHERE NOT EXISTS (SELECT 1 FROM scarf_events_raw AS existing WHERE ${joinKey})`,
  ];
}
