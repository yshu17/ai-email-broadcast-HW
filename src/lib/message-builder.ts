import { buildMergeValues, escapeHtml, renderTemplate, renderTemplateHtml } from "./personalize";
import { htmlToText, wrapEmailDocument } from "./html";
import { emailLocale, type Locale } from "../i18n/locale";
import { translate } from "../i18n/translate";

export type RecipientLike = {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  customFields?: Record<string, unknown> | null;
  trackingToken?: string | null;
  unsubscribeToken?: string | null;
};

export type CampaignLike = {
  subject: string;
  compiledHtml: string;
  textBody?: string | null;
};

export type BuiltMessage = {
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
};

export function trackingPixelUrl(baseUrl: string, token: string): string {
  return `${baseUrl}/api/track/open/${encodeURIComponent(token)}`;
}

export function unsubscribeUrl(baseUrl: string, token: string): string {
  return `${baseUrl}/unsubscribe/${encodeURIComponent(token)}`;
}

/** POST target for RFC 8058 one-click unsubscribe. */
export function unsubscribePostUrl(baseUrl: string, token: string): string {
  return `${baseUrl}/api/unsubscribe/${encodeURIComponent(token)}`;
}

function pixelTag(url: string): string {
  return `<img src="${escapeHtml(url)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;outline:none;" />`;
}

function unsubscribeFooter(url: string, language: Locale): string {
  return `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e4e4e7;font-size:12px;line-height:1.5;color:#71717a;">
${escapeHtml(translate(language, "email.footer.reason"))}
<a href="${escapeHtml(url)}" style="color:#71717a;text-decoration:underline;">${escapeHtml(translate(language, "email.footer.unsubscribe"))}</a>
</div>`;
}

/**
 * Renders the exact message a recipient receives.
 *
 * `preview: true` produces the same body without a tracking pixel, so previews
 * and test sends can never pollute campaign statistics.
 */
export function buildMessage(options: {
  campaign: CampaignLike;
  recipient: RecipientLike;
  baseUrl: string;
  preview?: boolean;
  /** Real address for the mailto: form of List-Unsubscribe, when one exists. */
  unsubscribeMailto?: string | null;
  /** The language of the words the app adds (default: EMAIL_LANGUAGE, i.e. `ru`). */
  language?: Locale;
}): BuiltMessage {
  const { campaign, recipient, baseUrl, preview = false } = options;
  const language = options.language ?? emailLocale();

  const unsubUrl = recipient.unsubscribeToken
    ? unsubscribeUrl(baseUrl, recipient.unsubscribeToken)
    : `${baseUrl}/unsubscribe/preview`;

  const values = buildMergeValues(
    {
      email: recipient.email,
      firstName: recipient.firstName,
      lastName: recipient.lastName,
      customFields: recipient.customFields,
    },
    { unsubscribeUrl: unsubUrl },
  );

  const subject = renderTemplate(campaign.subject, values);
  let body = renderTemplateHtml(campaign.compiledHtml, values);

  // Authors can place the link themselves via {{unsubscribeUrl}}; otherwise we
  // append a footer, because every campaign email must carry one.
  if (!body.includes(unsubUrl)) body += unsubscribeFooter(unsubUrl, language);

  if (!preview && recipient.trackingToken) {
    body += pixelTag(trackingPixelUrl(baseUrl, recipient.trackingToken));
  }

  const html = wrapEmailDocument(body);

  const textSource = campaign.textBody?.trim()
    ? renderTemplate(campaign.textBody, values)
    : htmlToText(renderTemplateHtml(campaign.compiledHtml, values));
  const text = `${textSource}\n\n---\n${translate(language, "email.text.unsubscribe", { url: unsubUrl })}\n`;

  const headers: Record<string, string> = {};
  if (recipient.unsubscribeToken) {
    const postUrl = unsubscribePostUrl(baseUrl, recipient.unsubscribeToken);
    // Only advertise a mailto: form when a real, monitored address is available;
    // inventing `unsubscribe@domain` would just generate bounces.
    const mailto = options.unsubscribeMailto?.trim();
    headers["List-Unsubscribe"] = mailto
      ? `<${postUrl}>, <mailto:${mailto}?subject=unsubscribe>`
      : `<${postUrl}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  return { subject, html, text, headers };
}
