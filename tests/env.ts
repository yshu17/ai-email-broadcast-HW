import { config } from "dotenv";

/**
 * Runs in every test worker before any module is imported, so `@/lib/db` sees
 * the test database rather than the development one.
 */
config({ path: ".env", quiet: true });

const base = process.env.DATABASE_URL ?? "postgres://mailer:mailer@localhost:5435/mailer";
process.env.TEST_DATABASE_URL ??= base.replace(/\/([^/?]+)(\?|$)/, "/mailer_test$2");
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

process.env.ENCRYPTION_KEY ??= "0".repeat(64);
process.env.APP_URL ??= "https://mail.example.test";
process.env.WORKER_SECRET ??= "test-worker-secret";
process.env.SMTP_MAX_EMAILS_PER_HOUR ??= "5000";

// The developer test panel is off unless a test switches it on for itself. A developer's own `.env`
// (which is where the flag lives when they use the panel) must not change what the suite tests.
delete process.env.ENABLE_EMAIL_TEST_PANEL;
delete process.env.TEST_SMTP_PORT;
delete process.env.TEST_SMTP_OUTPUT_DIR;

// A fixed time zone for the whole suite, so nothing depends on the machine it runs on.
// Tests that care about a zone set it themselves; TZ=... npm test still overrides this,
// which is how the suite is checked under other zones.
process.env.TZ ??= "UTC";
