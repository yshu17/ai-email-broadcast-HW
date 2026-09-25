import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaignRecipients, suppressions } from "@/lib/db/schema";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { LocaleProvider } from "@/i18n/client";
import { getPublicLocale } from "@/i18n/server";
import { Rich } from "@/i18n/rich";
import { translate } from "@/i18n/translate";
import UnsubscribeForm from "./UnsubscribeForm";

export const dynamic = "force-dynamic";

/**
 * Public unsubscribe page. Requires no login: the token in the URL is the
 * credential. It only ever reveals the address the token already identifies.
 *
 * Its language is the visitor's (their choice, else their browser's, else the
 * language the mail was written in), not the admin's.
 */
export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const locale = await getPublicLocale();
  const t = (key: Parameters<typeof translate>[1], values?: Parameters<typeof translate>[2]) => translate(locale, key, values);

  const rows = await db
    .select({
      email: campaignRecipients.email,
      emailNormalized: campaignRecipients.emailNormalized,
    })
    .from(campaignRecipients)
    .where(eq(campaignRecipients.unsubscribeToken, token))
    .limit(1);

  const recipient = rows[0];
  const already = recipient
    ? (await db
        .select({ id: suppressions.id })
        .from(suppressions)
        .where(eq(suppressions.emailNormalized, recipient.emailNormalized))
        .limit(1)).length > 0
    : false;

  return (
    <LocaleProvider locale={locale}>
      <main lang={locale} className="flex min-h-screen items-center justify-center px-4">
        <div className="fixed right-4 top-4"><LanguageSwitcher /></div>
        <div className="card w-full max-w-md p-6 text-center">
          {!recipient ? (
            <>
              <h1 className="text-lg font-semibold">{t("unsubscribe.invalid.title")}</h1>
              <p className="hint mt-2">{t("unsubscribe.invalid.body")}</p>
            </>
          ) : already ? (
            <>
              <h1 className="text-lg font-semibold">{t("unsubscribe.done.title")}</h1>
              <p className="hint mt-2"><Rich text={t("unsubscribe.done.body", { email: recipient.email })} /></p>
            </>
          ) : (
            <UnsubscribeForm token={token} email={recipient.email} />
          )}
        </div>
      </main>
    </LocaleProvider>
  );
}
