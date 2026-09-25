import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";
import { badRequest, notFound, readJson, str, withAuthMutation } from "@/lib/api";
import { buildMessage } from "@/lib/message-builder";
import { appUrl, getSmtpConfig } from "@/lib/settings";
import { createTransport, sanitizeErrorMessage, sendMessage } from "@/lib/mailer";
import { isValidEmail } from "@/lib/email-address";
import { logSendAttempt } from "@/lib/queue";
import { getApiLocale } from "@/i18n/server";
import { translate } from "@/i18n/translate";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Sends exactly the campaign email to one address.
 *
 * No CampaignRecipient row is created and no tracking pixel is injected, so a
 * test send is invisible to campaign statistics. It does count against the SMTP
 * rate limit, because the provider counts it.
 */
export async function POST(request: Request, ctx: Ctx) {
  return withAuthMutation(async () => {
    const { id } = await ctx.params;
    const body = await readJson<{ to?: string; firstName?: string; lastName?: string }>(request);

    const to = str(body.to, "Recipient", { max: 254 });
    if (!isValidEmail(to)) badRequest("err.email.invalid");

    const rows = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
    const campaign = rows[0];
    if (!campaign) notFound("err.campaign.notFound");
    if (!campaign.subject.trim()) badRequest("err.campaign.subjectRequired");

    const config = await getSmtpConfig();
    if (!config) badRequest("err.smtp.configureFirst");

    const message = buildMessage({
      campaign,
      recipient: {
        email: to,
        firstName: body.firstName ?? "there",
        lastName: body.lastName ?? "",
      },
      baseUrl: appUrl(),
      preview: true,
    });

    const transport = createTransport(config);
    try {
      await sendMessage(transport, config, {
        to,
        subject: `[TEST] ${message.subject}`,
        html: message.html,
        text: message.text,
        fromName: campaign.fromName,
        fromEmail: campaign.fromEmail,
        replyTo: campaign.replyTo,
      });
      await logSendAttempt(1);
      return NextResponse.json({ ok: true, message: translate(await getApiLocale(), "common.testSentTo", { email: to }) });
    } catch (error) {
      return NextResponse.json(
        { ok: false, error: sanitizeErrorMessage(error, config) },
        { status: 400 },
      );
    } finally {
      transport.close();
    }
  });
}
