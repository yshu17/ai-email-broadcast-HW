import { NextResponse } from "next/server";
import { badRequest, readJson, str, withAuthMutation } from "@/lib/api";
import { getSmtpConfig } from "@/lib/settings";
import { createTransport, sanitizeErrorMessage, sendMessage } from "@/lib/mailer";
import { isValidEmail } from "@/lib/email-address";
import { getApiLocale } from "@/i18n/server";
import { translate } from "@/i18n/translate";

/**
 * Verifies the connection, and optionally sends a real test message.
 * Test sends never touch campaign statistics — they create no recipient rows.
 */
export async function POST(request: Request) {
  return withAuthMutation(async () => {
    const body = await readJson<{ to?: string; mode?: "verify" | "send" }>(request);
    const mode = body.mode === "send" ? "send" : "verify";

    const config = await getSmtpConfig();
    if (!config) badRequest("err.smtp.notConfigured");
    const locale = await getApiLocale();

    const transport = createTransport(config);
    try {
      await transport.verify();
      if (mode === "verify") {
        return NextResponse.json({
          ok: true,
          message: translate(locale, "smtp.connected", { host: config.host, port: config.port }),
        });
      }

      const to = str(body.to, "Recipient", { max: 254 });
      if (!isValidEmail(to)) badRequest("err.settings.recipientInvalid");

      await sendMessage(transport, config, {
        to,
        subject: translate(locale, "email.smtpTest.subject"),
        html: `<p>${translate(locale, "email.smtpTest.body")}</p>`,
        text: translate(locale, "email.smtpTest.body"),
      });
      return NextResponse.json({ ok: true, message: translate(locale, "common.testSentTo", { email: to }) });
    } catch (error) {
      // sanitizeErrorMessage strips any credential that appears in the error.
      return NextResponse.json({ ok: false, error: sanitizeErrorMessage(error, config) }, { status: 400 });
    } finally {
      transport.close();
    }
  });
}
