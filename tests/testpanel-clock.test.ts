import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "@/lib/db";
import { PATCH as reschedule, POST as schedule } from "@/app/api/campaigns/[id]/schedule/route";
import { POST as postClock } from "@/app/api/dev/clock/route.dev";
import { clock, clockSnapshot, resetClock, setFixedTime } from "@/lib/clock";
import { runSchedulerCycle } from "@/lib/scheduler";
import { clockAction } from "@/lib/testing/actions";
import { CLOCK_STEPS, TEST_LIMITS } from "@/lib/testing/limits";
import { HttpError } from "@/lib/auth";
import { addBulkContacts, createCampaign, createList, getCampaign, resetDatabase } from "./helpers";
import { HOUR, ctx, disableTestTools, enableTestTools, jsonRequest } from "./testpanel-helpers";

/**
 * The test clock: held at a chosen instant inside the server process, moved by hand,
 * and read by the two things that judge scheduled times, the API's validation and the
 * scheduler. It never touches the computer's own clock, and production cannot use it.
 */
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    requireUser: async () => ({ id: "test-admin", email: "admin@example.test" }),
    requireAdminMutation: async () => ({ id: "test-admin", email: "admin@example.test" }),
    assertSameOrigin: async () => undefined,
  };
});

beforeEach(async () => {
  await resetDatabase();
  await enableTestTools();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(async () => {
  await disableTestTools();
  vi.restoreAllMocks();
});

afterAll(async () => { await sql.end(); });

const set = (date: string, time: string, timeZone = "UTC", extra: Record<string, unknown> = {}) =>
  clockAction({ action: "set", date, time, timeZone, ...extra });

const refusal = (fn: () => unknown): HttpError => {
  try {
    fn();
  } catch (error) {
    if (error instanceof HttpError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
};

describe("holding the clock at a time", () => {
  it("starts on the real clock", () => {
    const snapshot = clockSnapshot();
    expect(snapshot.mode).toBe("real");
    expect(snapshot.fixedAt).toBeNull();
    // On the real clock the "effective" time is simply the real one.
    expect(Math.abs(new Date(snapshot.effectiveNow).getTime() - new Date(snapshot.realNow).getTime())).toBeLessThan(2000);
    expect(clock.isSimulated()).toBe(false);
    expect(clock.dbNow()).toBeUndefined();
  });

  it("can be set to a date, a time and a zone, and shows both the real and the effective time", () => {
    const snapshot = set("2026-10-15", "10:25", "Europe/Warsaw");

    // Warsaw is UTC+2 in October (summer time).
    expect(snapshot.mode).toBe("fixed");
    expect(snapshot.fixedAt).toBe("2026-10-15T08:25:00.000Z");
    expect(snapshot.effectiveNow).toBe("2026-10-15T08:25:00.000Z");
    expect(Math.abs(new Date(snapshot.realNow).getTime() - Date.now())).toBeLessThan(2000);
    expect(clock.now().toISOString()).toBe("2026-10-15T08:25:00.000Z");
    expect(clock.dbNow()?.toISOString()).toBe("2026-10-15T08:25:00.000Z");
  });

  it("reads the wall-clock time in the zone it was given", () => {
    expect(set("2026-10-15", "10:25", "UTC").fixedAt).toBe("2026-10-15T10:25:00.000Z");
    expect(set("2026-10-15", "10:25", "Asia/Tokyo").fixedAt).toBe("2026-10-15T01:25:00.000Z");
    expect(set("2026-10-15", "10:25", "America/New_York").fixedAt).toBe("2026-10-15T14:25:00.000Z");
    expect(set("2026-01-15", "10:25", "Europe/Warsaw").fixedAt).toBe("2026-01-15T09:25:00.000Z"); // winter: UTC+1
  });

  it("holds still: a held clock does not tick", async () => {
    set("2026-10-15", "10:25");
    const first = clock.now().getTime();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(clock.now().getTime()).toBe(first);
  });

  it("can be set to a time in the past as well as the future", () => {
    expect(set("2020-06-01", "12:00").fixedAt).toBe("2020-06-01T12:00:00.000Z");
    expect(set("2090-06-01", "12:00").fixedAt).toBe("2090-06-01T12:00:00.000Z");
  });

  it("takes either of the two instants when clocks going back repeat a time, the earlier by default", () => {
    // Warsaw, 25 Oct 2026: 03:00 CEST becomes 02:00 CET, so 02:30 happens twice.
    expect(set("2026-10-25", "02:30", "Europe/Warsaw").fixedAt).toBe("2026-10-25T00:30:00.000Z");
    expect(set("2026-10-25", "02:30", "Europe/Warsaw", { occurrence: "second" }).fixedAt).toBe("2026-10-25T01:30:00.000Z");
  });

  it("refuses a time the clocks skip, a zone that does not exist, and years out of range", () => {
    expect(refusal(() => set("2027-03-28", "02:30", "Europe/Warsaw")).details).toMatchObject({ code: "SCHEDULE_NONEXISTENT" });
    expect(refusal(() => set("2026-10-15", "10:25", "Mars/Olympus")).status).toBe(400);
    expect(refusal(() => set("2026-02-31", "10:25")).details).toMatchObject({ code: "SCHEDULE_INVALID" });
    expect(refusal(() => set("2026-10-15", "25:00")).details).toMatchObject({ code: "SCHEDULE_INVALID" });
    expect(refusal(() => set("", "10:25")).details).toMatchObject({ code: "SCHEDULE_REQUIRED" });
    expect(refusal(() => set("1999-12-31", "23:59")).details).toMatchObject({ code: "TEST_RANGE", field: "clock" });
    expect(refusal(() => set("2101-01-01", "00:00")).details).toMatchObject({ code: "TEST_RANGE", field: "clock" });
    expect(clock.isSimulated()).toBe(false); // none of those changed anything
  });

  it("uses the bounds it advertises", () => {
    expect(set(`${TEST_LIMITS.clockYear.min}-01-01`, "00:00").mode).toBe("fixed");
    expect(set(`${TEST_LIMITS.clockYear.max}-12-31`, "23:59").mode).toBe("fixed");
  });
});

describe("moving the held clock forward", () => {
  it.each(CLOCK_STEPS)("advances by one $id ($seconds seconds)", ({ id, seconds }) => {
    set("2026-10-15", "10:25");

    const snapshot = clockAction({ action: "advance", step: id });

    expect(new Date(snapshot.effectiveNow).getTime()).toBe(Date.parse("2026-10-15T10:25:00.000Z") + seconds * 1000);
    expect(snapshot.mode).toBe("fixed");
  });

  it("adds up over several presses", () => {
    set("2026-10-15", "10:25");
    clockAction({ action: "advance", step: "fiveMinutes" });
    clockAction({ action: "advance", step: "fiveMinutes" });
    expect(clockAction({ action: "advance", step: "hour" }).effectiveNow).toBe("2026-10-15T11:35:00.000Z");
  });

  it("does the example from the help: 10:25 plus 5 minutes is 10:30", () => {
    set("2026-10-15", "10:25");
    expect(clockAction({ action: "advance", step: "fiveMinutes" }).effectiveNow).toBe("2026-10-15T10:30:00.000Z");
  });

  it("needs the clock to be held first; on the real clock it refuses (409) and changes nothing", () => {
    const error = refusal(() => clockAction({ action: "advance", step: "hour" }));
    expect(error.status).toBe(409);
    expect(clock.isSimulated()).toBe(false);
  });

  it("refuses a step it does not offer, and one that would leave the allowed years", () => {
    set("2026-10-15", "10:25");
    expect(refusal(() => clockAction({ action: "advance", step: "fortnight" })).status).toBe(400);
    expect(refusal(() => clockAction({ action: "advance", step: 60 })).status).toBe(400);

    set(`${TEST_LIMITS.clockYear.max}-12-31`, "23:59");
    expect(refusal(() => clockAction({ action: "advance", step: "day" })).details).toMatchObject({ code: "TEST_RANGE" });
  });

  it("offers exactly one minute, five minutes, one hour and one day", () => {
    expect(CLOCK_STEPS.map((step) => step.seconds)).toEqual([60, 300, 3600, 86400]);
  });
});

describe("returning to the real clock", () => {
  it("Reset puts the real clock back, at once", () => {
    set("2030-01-01", "00:00");
    expect(clock.isSimulated()).toBe(true);

    const snapshot = clockAction({ action: "reset" });

    expect(snapshot.mode).toBe("real");
    expect(snapshot.fixedAt).toBeNull();
    expect(Math.abs(clock.now().getTime() - Date.now())).toBeLessThan(2000);
    expect(clock.dbNow()).toBeUndefined();
  });

  it("Reset is harmless when there is nothing to reset", () => {
    expect(clockAction({ action: "reset" }).mode).toBe("real");
    expect(clockAction({ action: "reset" }).mode).toBe("real");
  });

  it("is what ending the process does: a fresh process starts on the real clock", () => {
    set("2030-01-01", "00:00");
    resetClock(); // the same state a restart begins from
    expect(clockSnapshot().mode).toBe("real");
  });
});

describe("the computer's own clock", () => {
  it("is never changed: Date, Date.now() and timers stay real while the test clock is held far away", async () => {
    const before = Date.now();
    set("2001-01-01", "00:00");
    clockAction({ action: "advance", step: "day" });

    const during = Date.now();
    expect(Math.abs(during - before)).toBeLessThan(2000);
    expect(new Date().getUTCFullYear()).toBe(new Date(before).getUTCFullYear());

    let ticked = false;
    setTimeout(() => { ticked = true; }, 20);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(ticked).toBe(true);
  });

  it("is not read by code that does not ask for the test clock: the database still says what time it really is", async () => {
    set("2001-01-01", "00:00");
    const [row] = await sql<{ year: number }[]>`SELECT extract(year FROM now())::int AS year`;
    expect(row.year).toBe(new Date().getUTCFullYear());
  });
});

describe("the endpoint", () => {
  it("sets, advances and resets through POST /api/dev/clock", async () => {
    const set = await postClock(jsonRequest("POST", { action: "set", date: "2026-10-15", time: "10:25", timeZone: "Europe/Warsaw" }));
    expect(set.status).toBe(200);
    expect((await set.json()).clock).toMatchObject({ mode: "fixed", effectiveNow: "2026-10-15T08:25:00.000Z" });

    const advanced = await postClock(jsonRequest("POST", { action: "advance", step: "fiveMinutes" }));
    expect((await advanced.json()).clock.effectiveNow).toBe("2026-10-15T08:30:00.000Z");

    const reset = await postClock(jsonRequest("POST", { action: "reset" }));
    expect((await reset.json()).clock.mode).toBe("real");
  });

  it("answers a bad request with the API's own error shape", async () => {
    const response = await postClock(jsonRequest("POST", { action: "set", date: "2026-10-15", time: "10:25", timeZone: "Nowhere/Land" }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(typeof body.error).toBe("string");
    expect(body).toMatchObject({ code: "TEST_INVALID", field: "timeZone" });
  });

  it("refuses an action it does not know", async () => {
    expect((await postClock(jsonRequest("POST", { action: "rewind" }))).status).toBe(400);
    expect((await postClock(jsonRequest("POST", {}))).status).toBe(400);
  });
});

/* ------------------------------------------------ what reads the clock, and what does not */

async function scheduledCampaign(at: Date, contacts = 3) {
  const listId = await createList(`List ${Math.random()}`);
  await addBulkContacts(listId, contacts, `${Math.random().toString(36).slice(2, 8)}.test`);
  return createCampaign({ listIds: [listId], status: "SCHEDULED", scheduledAt: at });
}

describe("the scheduler reads the shared clock", () => {
  it("does not start a campaign until the held clock reaches its time, then starts it", async () => {
    set("2026-10-15", "10:25");
    const id = await scheduledCampaign(new Date("2026-10-15T10:30:00.000Z"));

    // The real time is long past 10:30 on 15 Oct 2026?  It is not: this is about the *held* time.
    const early = await runSchedulerCycle("run-now");
    expect(early).toMatchObject({ ran: true });
    expect((await getCampaign(id)).status).toBe("SCHEDULED");

    clockAction({ action: "advance", step: "minute" }); // 10:26
    await runSchedulerCycle("run-now");
    expect((await getCampaign(id)).status).toBe("SCHEDULED");

    for (let i = 0; i < 3; i += 1) clockAction({ action: "advance", step: "minute" }); // 10:29
    await runSchedulerCycle("run-now");
    expect((await getCampaign(id)).status).toBe("SCHEDULED");

    clockAction({ action: "advance", step: "minute" }); // 10:30
    const due = await runSchedulerCycle("run-now");
    expect(due.ran && due.report.result?.dueCampaigns).toBe(1);
    expect((await getCampaign(id)).status).toMatch(/QUEUED|SENDING|COMPLETED/);
  });

  it("starts a campaign whose time is far ahead of the real clock once the held clock gets there", async () => {
    const wayAhead = new Date(Date.now() + 400 * 24 * HOUR);
    const id = await scheduledCampaign(wayAhead);

    expect((await runSchedulerCycle("run-now")).ran).toBe(true);
    expect((await getCampaign(id)).status).toBe("SCHEDULED"); // real time: not yet

    setFixedTime(new Date(wayAhead.getTime() + 1000));
    await runSchedulerCycle("run-now");
    expect((await getCampaign(id)).status).not.toBe("SCHEDULED");
  });

  it("goes back to the database's clock when the test clock is reset", async () => {
    const wayAhead = new Date(Date.now() + 400 * 24 * HOUR);
    const id = await scheduledCampaign(wayAhead);
    setFixedTime(new Date(wayAhead.getTime() + 1000));
    clockAction({ action: "reset" });

    await runSchedulerCycle("run-now");

    expect((await getCampaign(id)).status).toBe("SCHEDULED");
  });

  it("reports which time it judged by", async () => {
    set("2026-10-15", "10:25");
    const held = await runSchedulerCycle("run-now");
    expect(held.ran && held.report).toMatchObject({ simulatedClock: true, effectiveNow: "2026-10-15T10:25:00.000Z" });

    clockAction({ action: "reset" });
    const real = await runSchedulerCycle("run-now");
    expect(real.ran && real.report.simulatedClock).toBe(false);
  });

  it("uses the real clock in production even if a test time was left held", async () => {
    const wayAhead = new Date(Date.now() + 400 * 24 * HOUR);
    const id = await scheduledCampaign(wayAhead);
    setFixedTime(new Date(wayAhead.getTime() + 1000));

    vi.stubEnv("NODE_ENV", "production");
    await runSchedulerCycle("worker");

    expect((await getCampaign(id)).status).toBe("SCHEDULED");
  });
});

describe("server-side validation reads the shared clock", () => {
  async function draft() {
    const listId = await createList("Subscribers");
    await addBulkContacts(listId, 2, "clock.test");
    return createCampaign({ listIds: [listId] });
  }
  const post = (id: string, scheduledAt: string) => schedule(jsonRequest("POST", { scheduledAt }), ctx(id));
  const patch = (id: string, scheduledAt: string) => reschedule(jsonRequest("PATCH", { scheduledAt }), ctx(id));

  it("judges 'in the future' against the held time, not the real one (a time already gone for real can be ahead)", async () => {
    set("2020-06-01", "12:00"); // the held time is in the past, as the world sees it
    const id = await draft();

    const response = await post(id, "2020-06-01T12:05:00.000Z");

    expect(response.status).toBe(200);
    expect((await getCampaign(id)).status).toBe("SCHEDULED");
  });

  it("refuses a time that is ahead of the real clock but behind the held one", async () => {
    set("2090-01-01", "00:00"); // held far in the future
    const id = await draft();

    const response = await post(id, new Date(Date.now() + 24 * HOUR).toISOString());

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "SCHEDULE_PAST" });
    expect((await getCampaign(id)).status).toBe("DRAFT");
  });

  it("refuses the held moment itself, exactly as it refuses 'now'", async () => {
    set("2026-10-15", "10:25");
    const id = await draft();

    expect((await post(id, "2026-10-15T10:25:00.000Z")).status).toBe(400);
    expect((await post(id, "2026-10-15T10:25:01.000Z")).status).toBe(200);
  });

  it("applies the same rule when a schedule is moved, and to whether its time has already come", async () => {
    set("2026-10-15", "10:25");
    const id = await scheduledCampaign(new Date("2026-10-15T10:30:00.000Z"));

    expect((await patch(id, "2026-10-15T10:24:00.000Z")).status).toBe(400); // behind the held time
    expect((await patch(id, "2026-10-15T11:00:00.000Z")).status).toBe(200);

    clockAction({ action: "advance", step: "hour" }); // 11:25, past the new 11:00
    const late = await patch(id, "2026-10-15T13:00:00.000Z");
    expect(late.status).toBe(409); // its time has come, by the held clock: the scheduler's now
  });

  it("goes back to the system clock for validation after a reset", async () => {
    set("2020-06-01", "12:00");
    clockAction({ action: "reset" });
    const id = await draft();

    expect((await post(id, "2020-06-01T12:05:00.000Z")).status).toBe(400);
  });
});
