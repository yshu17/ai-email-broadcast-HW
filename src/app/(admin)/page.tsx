import Link from "next/link";
import { sql } from "@/lib/db";
import { queueSnapshot } from "@/lib/queue";
import { getSmtpConfig } from "@/lib/settings";
import { effectiveHourlyLimit } from "@/lib/rate-limit";
import { formatNumber } from "@/i18n/format";
import { getLocale } from "@/i18n/server";
import { intlTag } from "@/i18n/locale";
import { translate } from "@/i18n/translate";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const locale = await getLocale();
  const t = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate(locale, key, params);
  const n = (value: number | string) => formatNumber(Number(value), locale);

  const [totals] = await sql<Record<string, string>[]>`
    SELECT
      (SELECT count(*) FROM contacts)::text                                     AS contacts,
      (SELECT count(*) FROM contact_lists)::text                                AS lists,
      (SELECT count(*) FROM campaigns)::text                                    AS campaigns,
      (SELECT count(*) FROM suppressions)::text                                 AS suppressions,
      (SELECT count(*) FROM campaign_recipients
        WHERE delivery_status = 'SENT' AND sent_at > now() - interval '7 days')::text AS sent_7d,
      (SELECT count(*) FROM campaign_recipients WHERE delivery_status = 'SENT')::text AS sent_total,
      (SELECT count(*) FROM campaign_recipients
        WHERE delivery_status = 'SENT' AND first_opened_at IS NOT NULL)::text   AS opened_total
  `;

  const queue = await queueSnapshot();
  const config = await getSmtpConfig().catch(() => null);
  const maxPerHour = config?.maxEmailsPerHour ?? Number(process.env.SMTP_MAX_EMAILS_PER_HOUR ?? 5000);

  const sentTotal = Number(totals?.sent_total ?? 0);
  const openedTotal = Number(totals?.opened_total ?? 0);
  const openRate = sentTotal > 0 ? openedTotal / sentTotal : 0;

  const cards = [
    { label: t("nav.contacts"), value: n(totals?.contacts ?? "0"), href: "/contacts" },
    { label: t("nav.lists"), value: n(totals?.lists ?? "0"), href: "/lists" },
    { label: t("nav.campaigns"), value: n(totals?.campaigns ?? "0"), href: "/campaigns" },
    { label: t("nav.suppressions"), value: n(totals?.suppressions ?? "0"), href: "/suppressions" },
  ];

  const steps = [
    { before: t("dashboard.step1.before"), href: "/settings", label: t("nav.settings") },
    { before: t("dashboard.step2.before"), href: "/lists", label: t("nav.lists") },
    { before: t("dashboard.step3.before"), href: "/campaigns", label: t("nav.campaigns") },
  ];

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t("dashboard.title")}</h1>
        <Link className="btn btn-primary" href="/campaigns/new">{t("dashboard.newCampaign")}</Link>
      </div>

      {!config ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          {t("dashboard.smtpMissing")} <Link className="underline" href="/settings">{t("dashboard.smtpSetUp")}</Link>{" "}
          {t("dashboard.smtpBeforeSending")}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((card) => (
          <Link key={card.href} href={card.href} className="card px-4 py-3 transition hover:opacity-80">
            <p className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-muted)" }}>
              {card.label}
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{card.value}</p>
          </Link>
        ))}
      </div>

      <section className="grid gap-3 md:grid-cols-3">
        <div className="card px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-muted)" }}>
            {t("dashboard.sent7d")}
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{n(totals?.sent_7d ?? "0")}</p>
          <p className="hint mt-0.5">{t("dashboard.sentAllTime", { count: sentTotal })}</p>
        </div>
        <div className="card px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-muted)" }}>
            {t("dashboard.queue")}
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{n(queue.queued)}</p>
          <p className="hint mt-0.5">
            {t("dashboard.queueDetail", {
              sending: n(queue.sending), used: n(queue.sentLastHour), limit: n(effectiveHourlyLimit(maxPerHour)),
            })}
          </p>
        </div>
        <div className="card px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-muted)" }}>
            {t("dashboard.openRate")}
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {new Intl.NumberFormat(intlTag(locale), { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(openRate)}
          </p>
          <p className="hint mt-0.5">{t("dashboard.opensApproximate")}</p>
        </div>
      </section>

      <section className="card p-4">
        <h2 className="font-medium">{t("dashboard.gettingStarted")}</h2>
        <ol className="mt-2 grid gap-1 text-sm" style={{ color: "var(--color-muted)" }}>
          {steps.map((step, index) => (
            <li key={step.href}>
              {index + 1}. {step.before} <Link className="underline" href={step.href}>{step.label}</Link>.
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
