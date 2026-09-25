import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nodemailer from "nodemailer";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TEST_EMAIL_DOMAIN, isTestAddress, parseTestAddress, testAddress } from "@/lib/testing/test-addresses";
import { TEST_LIMITS } from "@/lib/testing/limits";
import { startTestSmtp, type TestSmtp } from "@/lib/testing/test-smtp";

/**
 * The built-in test SMTP server, spoken to by the same mail library the app uses.
 * The address decides the reply, and nothing but a made-up test address is ever accepted.
 */
let smtp: TestSmtp;
let folder: string;

beforeEach(async () => {
  folder = mkdtempSync(join(tmpdir(), "test-smtp-"));
  smtp = await startTestSmtp({ outputDir: folder, delayUnitMs: 20 });
});

afterEach(async () => {
  await smtp.close();
  rmSync(folder, { recursive: true, force: true });
});

const send = (to: string, subject = "Hello") =>
  nodemailer
    .createTransport({ host: smtp.host, port: smtp.port, secure: false, ignoreTLS: true })
    .sendMail({ from: `Test <sender@${TEST_EMAIL_DOMAIN}>`, to, subject, text: "Body text", html: "<p>Body</p>" });

const failure = async (to: string): Promise<{ responseCode?: number; message: string }> => {
  try {
    await send(to);
  } catch (error) {
    return error as { responseCode?: number; message: string };
  }
  throw new Error("expected the message to be refused");
};

describe("test addresses", () => {
  it("are made up, in a domain the standards keep for tests", () => {
    expect(TEST_EMAIL_DOMAIN).toBe("test.invalid");
    expect(testAddress({ scenario: "success" }, "ab12cd", 7)).toBe("success-ab12cd-007@test.invalid");
  });

  it("carry their scenario, so the server needs no memory", () => {
    expect(parseTestAddress("success-ab12cd-001@test.invalid")).toEqual({ scenario: "success" });
    expect(parseTestAddress("permfail-ab12cd-001@test.invalid")).toEqual({ scenario: "permfail" });
    expect(parseTestAddress("tempfail2-ab12cd-001@test.invalid")).toEqual({ scenario: "tempfail", failures: 2 });
    expect(parseTestAddress("tempfail-ab12cd-001@test.invalid")).toEqual({ scenario: "tempfail", failures: TEST_LIMITS.temporaryFailures.default });
    expect(parseTestAddress("slow5-ab12cd-001@test.invalid")).toEqual({ scenario: "slow", delaySeconds: 5 });
    expect(parseTestAddress("slow-ab12cd-001@test.invalid")).toEqual({ scenario: "slow", delaySeconds: TEST_LIMITS.slowDelaySeconds.default });
  });

  it("round-trip through their own constructor", () => {
    for (const plan of [
      { scenario: "success" }, { scenario: "permfail" },
      { scenario: "tempfail", failures: 3 }, { scenario: "slow", delaySeconds: 9 },
    ] as const) {
      expect(parseTestAddress(testAddress(plan, "zz99", 12))).toEqual(plan);
    }
  });

  it("do not include anything that is not one: real domains, odd names, other scenarios", () => {
    for (const address of [
      "person@example.com", "success-ab12cd-001@example.com", "success-ab12cd-001@test.invalid.evil.com",
      "hello@test.invalid", "success@test.invalid", "success-ab12cd@test.invalid", "unknown-ab12cd-001@test.invalid",
      "success-ab12cd-001@sub.test.invalid", "", "not an address",
    ]) {
      expect(isTestAddress(address), address).toBe(false);
    }
  });
});

describe("a recipient that succeeds", () => {
  it("is accepted, and the message is kept as an .eml file in the folder", async () => {
    const info = await send("success-ab12cd-001@test.invalid", "Greetings");

    expect(info.accepted).toEqual(["success-ab12cd-001@test.invalid"]);
    const files = readdirSync(folder);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^001_success-ab12cd-001@test\.invalid\.eml$/);
    const eml = readFileSync(join(folder, files[0]), "utf8");
    expect(eml).toContain("Subject: Greetings");
    expect(eml).toContain("Body text");
    expect(smtp.counts().accepted).toBe(1);
    expect(smtp.received()[0]).toMatchObject({ to: "success-ab12cd-001@test.invalid", scenario: "success" });
  });

  it("numbers the files in the order they came", async () => {
    await send("success-ab12cd-001@test.invalid");
    await send("success-ab12cd-002@test.invalid");
    expect(readdirSync(folder).sort()).toEqual([
      "001_success-ab12cd-001@test.invalid.eml", "002_success-ab12cd-002@test.invalid.eml",
    ]);
  });

  it("keeps nothing on disk when it has no folder", async () => {
    const quiet = await startTestSmtp({ outputDir: null });
    try {
      await nodemailer.createTransport({ host: quiet.host, port: quiet.port, secure: false, ignoreTLS: true })
        .sendMail({ from: "a@test.invalid", to: "success-ab12cd-001@test.invalid", subject: "x", text: "y" });
      expect(quiet.counts().accepted).toBe(1);
      expect(quiet.received()[0].file).toBeNull();
    } finally {
      await quiet.close();
    }
  });
});

describe("a recipient that fails for good", () => {
  it("is refused with a 550 every time", async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const error = await failure("permfail-ab12cd-001@test.invalid");
      expect(error.responseCode).toBe(550);
    }
    expect(smtp.counts()).toMatchObject({ accepted: 0, refusedPermanently: 3 });
    expect(readdirSync(folder)).toEqual([]);
  });
});

describe("a recipient that fails for a while", () => {
  it("is refused with a temporary 451 the first k times, then accepted", async () => {
    const address = "tempfail2-ab12cd-001@test.invalid";

    expect((await failure(address)).responseCode).toBe(451);
    expect((await failure(address)).responseCode).toBe(451);
    const info = await send(address);

    expect(info.accepted).toEqual([address]);
    expect(smtp.counts()).toMatchObject({ accepted: 1, refusedTemporarily: 2 });
  });

  it("counts each address on its own", async () => {
    expect((await failure("tempfail1-ab12cd-001@test.invalid")).responseCode).toBe(451);
    expect((await failure("tempfail1-ab12cd-002@test.invalid")).responseCode).toBe(451);
    expect((await send("tempfail1-ab12cd-001@test.invalid")).accepted).toHaveLength(1);
  });
});

describe("a recipient that is slow", () => {
  it("is accepted only after the delay in its address", async () => {
    const started = Date.now();
    const info = await send("slow5-ab12cd-001@test.invalid"); // 5 units of 20 ms in this test
    const took = Date.now() - started;

    expect(info.accepted).toHaveLength(1);
    expect(took).toBeGreaterThanOrEqual(90);
  });

  it("does not hold up another recipient's message", async () => {
    const slow = send("slow10-ab12cd-001@test.invalid");
    const quickStarted = Date.now();
    await send("success-ab12cd-002@test.invalid");
    expect(Date.now() - quickStarted).toBeLessThan(150);
    await slow;
  });
});

describe("an address that is not a test address", () => {
  it("is refused outright, so nothing can be delivered to anyone", async () => {
    for (const address of ["someone@example.com", "boss@company.example", "success-ab12cd-001@example.org"]) {
      const error = await failure(address);
      expect(error.responseCode, address).toBe(550);
      expect(error.message).toContain("test.invalid");
    }
    expect(smtp.counts()).toMatchObject({ accepted: 0, refusedForeign: 3 });
    expect(readdirSync(folder)).toEqual([]);
  });

  it("does not let a foreign address ride along with a good one: only the test address is accepted", async () => {
    const info = await send("success-ab12cd-001@test.invalid, someone@example.com");

    expect(info.accepted).toEqual(["success-ab12cd-001@test.invalid"]);
    expect(info.rejected).toEqual(["someone@example.com"]);
    expect(smtp.received().map((mail) => mail.to)).toEqual(["success-ab12cd-001@test.invalid"]);
  });
});

describe("where it listens", () => {
  it("only on the loopback interface, never on the network", () => {
    expect(smtp.host).toBe("127.0.0.1");
    expect(smtp.port).toBeGreaterThan(0);
  });
});
