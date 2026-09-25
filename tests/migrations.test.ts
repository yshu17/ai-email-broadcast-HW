import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import "./env";

/**
 * The scheduling migration (0002) against databases of its own, created and dropped
 * here: an empty one, and one that already holds campaigns from before scheduling
 * existed. The shared test database is untouched.
 */
const baseUrl = new URL(process.env.DATABASE_URL as string);
const adminUrl = new URL(baseUrl.toString());
adminUrl.pathname = "/postgres";
const admin = postgres(adminUrl.toString(), { max: 1, prepare: false, onnotice: () => {} });

let dbName = "";
let client: postgres.Sql;

function urlFor(name: string): string {
  const url = new URL(baseUrl.toString());
  url.pathname = `/${name}`;
  return url.toString();
}

beforeEach(async () => {
  dbName = `mailer_migration_${Math.random().toString(36).slice(2, 10)}`;
  await admin.unsafe(`CREATE DATABASE "${dbName}"`);
  client = postgres(urlFor(dbName), { max: 1, prepare: false, onnotice: () => {} });
}, 60_000); // creating a database can be slow while another test file is finishing with the server

afterEach(async () => {
  await client.end({ timeout: 5 });
  await admin.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
}, 60_000);

afterAll(async () => { await admin.end({ timeout: 5 }); });

/** A copy of the migrations folder that stops before the given tag, i.e. the schema as it was. */
function migrationsBefore(tag: string): string {
  const folder = mkdtempSync(join(tmpdir(), "migrations-"));
  cpSync("drizzle", folder, { recursive: true });
  const journalPath = join(folder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { tag: string }[] };
  const stop = journal.entries.findIndex((entry) => entry.tag === tag);
  journal.entries = journal.entries.slice(0, stop);
  writeFileSync(journalPath, JSON.stringify(journal));
  return folder;
}

const applyTo = (folder: string) => migrate(drizzle(client), { migrationsFolder: folder });

async function schedulingSchema() {
  const [enumRow] = await client<{ labels: string[] }[]>`
    SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
    FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid WHERE t.typname = 'campaign_status'`;
  const column = await client<{ data_type: string; is_nullable: string }[]>`
    SELECT data_type, is_nullable FROM information_schema.columns
    WHERE table_name = 'campaigns' AND column_name = 'scheduled_at'`;
  const check = await client<{ conname: string }[]>`
    SELECT conname FROM pg_constraint WHERE conname = 'campaigns_scheduled_requires_time'`;
  return { statuses: enumRow?.labels ?? [], column: column[0], hasCheck: check.length === 1 };
}

describe("migrating an empty database", () => {
  it("builds the whole schema, scheduling included", async () => {
    await applyTo("drizzle");

    const schema = await schedulingSchema();
    expect(schema.statuses).toEqual(["DRAFT", "SCHEDULED", "QUEUED", "SENDING", "PAUSED", "COMPLETED", "CANCELLED"]);
    expect(schema.column).toEqual({ data_type: "timestamp with time zone", is_nullable: "YES" });
    expect(schema.hasCheck).toBe(true);
  });

  it("is what `npm run db:migrate` does, and is safe to run again on every boot", async () => {
    const run = () => new Promise<{ code: number | null; out: string }>((resolve) => {
      const child = spawn(process.execPath, ["--import", "tsx", "scripts/migrate.ts"], {
        env: { ...process.env, DATABASE_URL: urlFor(dbName) }, windowsHide: true,
      });
      let out = "";
      child.stdout.on("data", (chunk) => { out += chunk; });
      child.stderr.on("data", (chunk) => { out += chunk; });
      child.on("exit", (code) => resolve({ code, out }));
    });

    const first = await run();
    const second = await run();

    expect(first).toMatchObject({ code: 0 });
    expect(first.out).toContain("Migrations applied.");
    expect(second).toMatchObject({ code: 0 });
    expect((await schedulingSchema()).statuses).toContain("SCHEDULED");
    const [{ n }] = await client<{ n: string }[]>`SELECT count(*)::text AS n FROM drizzle.__drizzle_migrations`;
    expect(Number(n)).toBe(3); // applied once each, not once per run
  }, 60_000);
});

describe("migrating a database that already holds campaigns", () => {
  const OLD_STATUSES = ["DRAFT", "QUEUED", "SENDING", "PAUSED", "COMPLETED", "CANCELLED"];

  async function seedOldData() {
    for (const status of OLD_STATUSES) {
      await client.unsafe(`INSERT INTO campaigns (name, subject, status, total_recipients) VALUES ('${status} campaign', 'Hello', '${status}', 2)`);
    }
    await client`
      INSERT INTO campaign_recipients (campaign_id, email, email_normalized, tracking_token, unsubscribe_token, delivery_status)
      SELECT c.id, 'a' || g || '@example.test', 'a' || g || '@example.test', 't' || c.id || g, 'u' || c.id || g,
             CASE WHEN c.status IN ('QUEUED', 'SENDING') THEN 'QUEUED' ELSE 'SENT' END::delivery_status
      FROM campaigns c, generate_series(1, 2) g`;
  }

  it("leaves every existing campaign and recipient exactly as it was, with no schedule", async () => {
    await applyTo(migrationsBefore("0002_campaign_scheduling"));
    expect((await schedulingSchema()).column).toBeUndefined(); // really the old schema
    await seedOldData();
    const before = await client`SELECT id, name, status, total_recipients FROM campaigns ORDER BY name`;
    const recipientsBefore = await client`SELECT campaign_id, email, delivery_status FROM campaign_recipients ORDER BY campaign_id, email`;

    await applyTo("drizzle");

    expect(await client`SELECT id, name, status, total_recipients FROM campaigns ORDER BY name`).toEqual(before);
    expect(await client`SELECT campaign_id, email, delivery_status FROM campaign_recipients ORDER BY campaign_id, email`).toEqual(recipientsBefore);
    const rows = await client<{ status: string; scheduled_at: Date | null }[]>`SELECT status, scheduled_at FROM campaigns`;
    expect(rows).toHaveLength(OLD_STATUSES.length);
    expect(rows.every((row) => row.scheduled_at === null)).toBe(true);
    expect((await schedulingSchema()).statuses).toContain("SCHEDULED");
  });

  it("keeps the old immediate-send flow working: no new field is required", async () => {
    await applyTo(migrationsBefore("0002_campaign_scheduling"));
    await seedOldData();
    await applyTo("drizzle");

    // A campaign created and queued the old way — no scheduled_at anywhere — is valid.
    const [draft] = await client<{ id: string }[]>`INSERT INTO campaigns (name) VALUES ('Old flow') RETURNING id`;
    await client`UPDATE campaigns SET status = 'QUEUED' WHERE id = ${draft.id}`;
    await client`UPDATE campaigns SET status = 'SENDING', started_at = now() WHERE id = ${draft.id}`;
    await client`UPDATE campaigns SET status = 'COMPLETED', completed_at = now() WHERE id = ${draft.id}`;
    const [row] = await client<{ status: string; scheduled_at: Date | null }[]>`SELECT status, scheduled_at FROM campaigns WHERE id = ${draft.id}`;
    expect(row).toEqual({ status: "COMPLETED", scheduled_at: null });
  });

  it("accepts SCHEDULED only with a time, and stores it as one instant", async () => {
    await applyTo("drizzle");

    await expect(client`INSERT INTO campaigns (name, status) VALUES ('No time', 'SCHEDULED')`)
      .rejects.toMatchObject({ constraint_name: "campaigns_scheduled_requires_time" });
    const [ok] = await client<{ id: string }[]>`
      INSERT INTO campaigns (name, status, scheduled_at) VALUES ('With time', 'SCHEDULED', '2026-10-15T10:00:00+02:00') RETURNING id`;
    const [stored] = await client<{ utc: string }[]>`
      SELECT to_char(scheduled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS utc FROM campaigns WHERE id = ${ok.id}`;
    expect(stored.utc).toBe("2026-10-15T08:00:00Z");
    // A schedule cannot be wiped while the campaign is still SCHEDULED…
    await expect(client`UPDATE campaigns SET scheduled_at = NULL WHERE id = ${ok.id}`)
      .rejects.toMatchObject({ constraint_name: "campaigns_scheduled_requires_time" });
    // …but is kept when it is cancelled.
    await client`UPDATE campaigns SET status = 'CANCELLED' WHERE id = ${ok.id}`;
    const [kept] = await client<{ scheduled_at: Date | null }[]>`SELECT scheduled_at FROM campaigns WHERE id = ${ok.id}`;
    expect(kept.scheduled_at).not.toBeNull();
  });

  it("does not disturb the migrations that were already recorded", async () => {
    const before = migrationsBefore("0002_campaign_scheduling");
    await applyTo(before);
    const recorded = await client`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id`;

    await applyTo("drizzle");

    const after = await client`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id`;
    expect(after.slice(0, recorded.length)).toEqual(recorded);
    expect(after).toHaveLength(recorded.length + 1);
    rmSync(before, { recursive: true, force: true });
  });
});
