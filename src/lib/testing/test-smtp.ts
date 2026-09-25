import { createServer, type Server, type Socket } from "node:net";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { emitEvent } from "../events";
import { processState } from "../process-state";
import { assertTestPanelEnabled } from "./access";
import { TEST_EMAIL_DOMAIN, parseTestAddress } from "./test-addresses";

/**
 * The built-in test SMTP server: the only mail server the app talks to while the
 * test panel is on.
 *
 * It is a sink, not a relay. It accepts a message for a made-up test address
 * (`*@test.invalid`), writes it to a `.eml` file in a local folder (`received-emails/`
 * by default, which is ignored by Git) and forgets it; it refuses every other address, so
 * nothing can ever be delivered to anyone. It listens on the loopback interface only.
 *
 * It is a real SMTP conversation (EHLO, MAIL, RCPT, DATA), so the queue's retry rules see
 * genuine `451` and `550` replies rather than a mock. The address decides the reply:
 *
 *   success   accepted
 *   tempfail  `451` the first k times an address is tried (k is in the address), then accepted
 *   permfail  `550`, every time
 *   slow      accepted, but the reply to the message is held back d seconds
 */
export type ReceivedMail = {
  at: string;
  to: string;
  scenario: string;
  bytes: number;
  file: string | null;
};

export type TestSmtp = {
  host: string;
  port: number;
  outputDir: string;
  /** Messages accepted, oldest first, capped. */
  received: () => ReceivedMail[];
  /** How many have been accepted, and how many refused, since it started. */
  counts: () => { accepted: number; refusedTemporarily: number; refusedPermanently: number; refusedForeign: number };
  close: () => Promise<void>;
};

const KEEP = 200;

export type TestSmtpOptions = {
  /** 0 (default): let the system pick a free port. */
  port?: number;
  /** Where `.eml` files go. `null`: keep nothing on disk. */
  outputDir?: string | null;
  /** Scales the `slow` delay (seconds → milliseconds). Tests shrink it; nothing else should. */
  delayUnitMs?: number;
};

export async function startTestSmtp(options: TestSmtpOptions = {}): Promise<TestSmtp> {
  const outputDir = options.outputDir === null ? null : resolve(options.outputDir ?? "received-emails");
  const delayUnitMs = options.delayUnitMs ?? 1000;
  const received: ReceivedMail[] = [];
  const counts = { accepted: 0, refusedTemporarily: 0, refusedPermanently: 0, refusedForeign: 0 };
  /** How many times each `tempfail` address has been refused so far. */
  const refusals = new Map<string, number>();
  let sequence = 0;

  if (outputDir) mkdirSync(outputDir, { recursive: true });

  const sockets = new Set<Socket>();

  const server: Server = createServer((socket: Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let buffer = "";
    let inData = false;
    let recipients: string[] = [];
    const pending = new Set<ReturnType<typeof setTimeout>>();

    const send = (line: string) => {
      if (!socket.destroyed) socket.write(`${line}\r\n`);
    };
    send(`220 ${TEST_EMAIL_DOMAIN} test ESMTP ready`);

    const finishMessage = (raw: string) => {
      const to = recipients[0] ?? "";
      const plan = parseTestAddress(to);
      const deliver = () => {
        sequence += 1;
        let file: string | null = null;
        if (outputDir) {
          const name = `${String(sequence).padStart(3, "0")}_${to.replace(/[^a-z0-9@._-]/gi, "_")}.eml`;
          file = join(outputDir, name);
          try {
            writeFileSync(file, raw, "utf8");
          } catch {
            file = null;
          }
        }
        counts.accepted += 1;
        received.push({ at: new Date().toISOString(), to, scenario: plan?.scenario ?? "success", bytes: raw.length, file });
        if (received.length > KEEP) received.shift();
        emitEvent({ type: "smtp.accepted", source: "smtp", data: { scenario: plan?.scenario ?? "success" } });
        send("250 2.0.0 Ok: queued (test server, nothing is delivered)");
      };

      if (plan?.scenario === "slow") {
        const timer = setTimeout(() => {
          pending.delete(timer);
          deliver();
        }, plan.delaySeconds * delayUnitMs);
        pending.add(timer);
      } else {
        deliver();
      }
      recipients = [];
    };

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");

      for (;;) {
        if (inData) {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end === -1) return;
          const raw = buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          inData = false;
          finishMessage(raw);
          continue;
        }

        const lineEnd = buffer.indexOf("\r\n");
        if (lineEnd === -1) return;
        const line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 2);
        const upper = line.toUpperCase();

        if (upper.startsWith("EHLO") || upper.startsWith("HELO")) {
          send(`250-${TEST_EMAIL_DOMAIN}`);
          send("250-AUTH PLAIN LOGIN");
          send("250 SIZE 10485760");
        } else if (upper.startsWith("AUTH")) {
          send("235 2.7.0 Accepted");
        } else if (upper.startsWith("MAIL FROM")) {
          send("250 2.1.0 Ok");
        } else if (upper.startsWith("RCPT TO")) {
          const address = line.slice(line.indexOf(":") + 1).trim().replace(/^<|>$/g, "").toLowerCase();
          const plan = parseTestAddress(address);
          if (!plan) {
            counts.refusedForeign += 1;
            send(`550 5.7.1 <${address}> refused: this server takes only ${TEST_EMAIL_DOMAIN} test addresses`);
          } else if (plan.scenario === "permfail") {
            counts.refusedPermanently += 1;
            send("550 5.1.1 Mailbox unavailable (test scenario: permanent failure)");
          } else if (plan.scenario === "tempfail" && (refusals.get(address) ?? 0) < plan.failures) {
            refusals.set(address, (refusals.get(address) ?? 0) + 1);
            counts.refusedTemporarily += 1;
            send("451 4.3.0 Try again later (test scenario: temporary failure)");
          } else {
            recipients.push(address);
            send("250 2.1.5 Ok");
          }
        } else if (upper === "DATA") {
          if (recipients.length === 0) {
            send("554 5.5.1 No valid recipients");
          } else {
            inData = true;
            send("354 End data with <CR><LF>.<CR><LF>");
          }
        } else if (upper === "QUIT") {
          send("221 2.0.0 Bye");
          socket.end();
          return;
        } else if (upper === "RSET") {
          recipients = [];
          send("250 2.0.0 Ok");
        } else {
          send("250 2.0.0 Ok");
        }
      }
    });

    socket.on("close", () => {
      for (const timer of pending) clearTimeout(timer);
    });
    socket.on("error", () => undefined);
  });

  // Loopback only: this server must never be reachable from another machine.
  await new Promise<void>((resolveListening, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => resolveListening());
  });
  const address = server.address();
  if (typeof address === "string" || address === null) throw new Error("Could not bind the test SMTP server.");

  return {
    host: "127.0.0.1",
    port: address.port,
    outputDir: outputDir ?? "",
    received: () => [...received],
    counts: () => ({ ...counts }),
    close: () =>
      new Promise<void>((resolveClosed) => {
        server.close(() => resolveClosed());
        for (const socket of sockets) socket.destroy();
      }),
  };
}

/* ------------------------------------------------ the one shared by the process */

type Shared = { starting: Promise<TestSmtp> | null; instance: TestSmtp | null };

const shared = processState<Shared>("test.smtp", () => ({ starting: null, instance: null }));

/**
 * The process's test SMTP server, started on first use and reused after. Only ever in a
 * development or test environment with the panel on.
 */
export async function ensureTestSmtp(): Promise<TestSmtp> {
  assertTestPanelEnabled("The test SMTP server");
  if (shared.instance) return shared.instance;
  shared.starting ??= startTestSmtp({
    port: Number(process.env.TEST_SMTP_PORT) || 0,
    outputDir: process.env.TEST_SMTP_OUTPUT_DIR || "received-emails",
  }).then((instance) => {
    shared.instance = instance;
    return instance;
  }, (error) => {
    shared.starting = null;
    throw error;
  });
  return shared.starting;
}

/** The running server, if it has been started; never starts one. */
export function currentTestSmtp(): TestSmtp | null {
  return shared.instance;
}

/** For tests: stop the shared server so the next use starts a fresh one. */
export async function stopSharedTestSmtp(): Promise<void> {
  const instance = shared.instance;
  shared.instance = null;
  shared.starting = null;
  if (instance) await instance.close();
}
