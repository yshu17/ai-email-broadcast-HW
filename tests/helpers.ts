import postgres from "postgres";
import { db, sql } from "@/lib/db";
import { campaignLists, campaignRecipients, campaigns, contactListMembers, contactLists, contacts, suppressions } from "@/lib/db/schema";
import { randomToken } from "@/lib/crypto";
import { normalizeEmail } from "@/lib/email-address";

/** Wipes every table between tests so each one starts from a known state. */
export async function resetDatabase(): Promise<void> {
  await sql`
    TRUNCATE campaign_recipients, campaign_lists, campaigns,
             contact_list_members, contact_lists, contacts,
             suppressions, smtp_send_log, sessions, users
    RESTART IDENTITY CASCADE
  `;
}

export async function createList(name: string): Promise<string> {
  const [row] = await db.insert(contactLists).values({ name }).returning({ id: contactLists.id });
  return row.id;
}

export async function addContact(
  listId: string | null,
  email: string,
  firstName?: string,
): Promise<string> {
  const [contact] = await db
    .insert(contacts)
    .values({ email, emailNormalized: normalizeEmail(email), firstName: firstName ?? null })
    .onConflictDoUpdate({ target: contacts.emailNormalized, set: { updatedAt: new Date() } })
    .returning({ id: contacts.id });

  if (listId) {
    await db
      .insert(contactListMembers)
      .values({ listId, contactId: contact.id })
      .onConflictDoNothing();
  }
  return contact.id;
}

/**
 * Adds `count` contacts (u1@…, u2@… …) to a list in one statement. Their
 * created_at ascends with the number, so the order recipients are generated in
 * is deterministic.
 */
export async function addBulkContacts(listId: string, count: number, domain = "example.test"): Promise<void> {
  await sql`
    WITH new_contacts AS (
      INSERT INTO contacts (email, email_normalized, created_at)
      SELECT 'u' || g || '@' || ${domain}::text,
             'u' || g || '@' || ${domain}::text,
             now() - ((${count}::int - g) * interval '1 second')
      FROM generate_series(1, ${count}::int) AS g
      RETURNING id
    )
    INSERT INTO contact_list_members (list_id, contact_id)
    SELECT ${listId}::uuid, id FROM new_contacts
  `;
}

export async function createCampaign(options: {
  name?: string;
  subject?: string;
  html?: string;
  listIds?: string[];
  status?: "DRAFT" | "SCHEDULED" | "QUEUED" | "SENDING" | "PAUSED" | "COMPLETED" | "CANCELLED";
  scheduledAt?: Date | null;
} = {}): Promise<string> {
  const [campaign] = await db
    .insert(campaigns)
    .values({
      name: options.name ?? "Test campaign",
      subject: options.subject ?? "Hello {{firstName}}",
      compiledHtml: options.html ?? "<p>Hi {{firstName}}</p>",
      contentHtml: options.html ?? "<p>Hi {{firstName}}</p>",
      status: options.status ?? "DRAFT",
      scheduledAt: options.scheduledAt ?? null,
    })
    .returning({ id: campaigns.id });

  for (const listId of options.listIds ?? []) {
    await db.insert(campaignLists).values({ campaignId: campaign.id, listId });
  }
  return campaign.id;
}

/** Inserts a recipient row directly, bypassing generation. */
export async function addRecipient(
  campaignId: string,
  email: string,
  overrides: Partial<typeof campaignRecipients.$inferInsert> = {},
) {
  const [row] = await db
    .insert(campaignRecipients)
    .values({
      campaignId,
      email,
      emailNormalized: normalizeEmail(email),
      trackingToken: randomToken(32),
      unsubscribeToken: randomToken(32),
      ...overrides,
    })
    .returning();
  return row;
}

export async function suppress(email: string, reason: "UNSUBSCRIBED" | "MANUAL" = "UNSUBSCRIBED") {
  await db
    .insert(suppressions)
    .values({ email, emailNormalized: normalizeEmail(email), reason })
    .onConflictDoNothing();
}

export async function getRecipient(id: string) {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT * FROM campaign_recipients WHERE id = ${id}
  `;
  return rows[0];
}

export async function getCampaign(id: string) {
  const rows = await sql<Record<string, unknown>[]>`SELECT * FROM campaigns WHERE id = ${id}`;
  return rows[0];
}

/** The stored scheduled_at as a UTC ISO string, straight from the database. */
export async function getScheduledAtUtc(campaignId: string): Promise<string | null> {
  const rows = await sql<{ iso: string | null }[]>`
    SELECT to_char(scheduled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS iso
    FROM campaigns WHERE id = ${campaignId}
  `;
  return rows[0]?.iso ?? null;
}

export async function countByStatus(campaignId: string): Promise<Record<string, number>> {
  const rows = await sql<{ delivery_status: string; count: string }[]>`
    SELECT delivery_status, count(*)::text AS count
    FROM campaign_recipients WHERE campaign_id = ${campaignId}
    GROUP BY delivery_status
  `;
  return Object.fromEntries(rows.map((r) => [r.delivery_status, Number(r.count)]));
}

/* ------------------------------------------------- process-level simulations */

type PoolGlobals = { __sql?: postgres.Sql; __db?: unknown };
const pool = globalThis as unknown as PoolGlobals;

/**
 * Stands in for the app process being stopped and started again: the connection
 * pool is closed and forgotten, and the next query opens a fresh one. Nothing but
 * the database survives, which is the point.
 */
export async function restartProcess(): Promise<void> {
  await sql.end({ timeout: 5 });
  delete pool.__sql;
  delete pool.__db;
}

/**
 * Runs `fn` while the app's database connection points at a port nothing listens
 * on, so every query fails the way it does when Postgres is down. The real pool is
 * put back afterwards, untouched.
 */
export async function withDatabaseDown<T>(fn: () => Promise<T>): Promise<T> {
  await sql`SELECT 1`; // make sure the real pool exists, so it can be restored
  const real = { sql: pool.__sql, db: pool.__db };
  const dead = postgres("postgres://mailer:mailer@127.0.0.1:1/mailer_test", {
    max: 1, connect_timeout: 2, prepare: false, onnotice: () => {},
  });
  pool.__sql = dead;
  pool.__db = undefined;
  try {
    return await fn();
  } finally {
    pool.__sql = real.sql;
    pool.__db = real.db;
    await dead.end({ timeout: 0 }).catch(() => undefined);
  }
}

/** Every recipient row of a campaign, for asserting exactly what was queued. */
export async function recipientRows(campaignId: string) {
  return sql<{ email_normalized: string; delivery_status: string; attempts: number }[]>`
    SELECT email_normalized, delivery_status, attempts
    FROM campaign_recipients WHERE campaign_id = ${campaignId} ORDER BY email_normalized
  `;
}
