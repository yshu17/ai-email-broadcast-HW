import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));

import { LocaleProvider } from "@/i18n/client";
import CampaignsTable, { type CampaignRow } from "@/app/(admin)/campaigns/CampaignsTable";
import CampaignReport from "@/app/(admin)/campaigns/[id]/CampaignReport";
import CampaignDetail from "@/app/(admin)/campaigns/[id]/CampaignDetail";
import CancelScheduledDialog, { requestCancelScheduled } from "@/components/CancelScheduledDialog";

const inRu = (node: React.ReactNode) => renderToStaticMarkup(<LocaleProvider locale="ru">{node}</LocaleProvider>);
const noop = () => undefined;

function row(overrides: Partial<CampaignRow> = {}): CampaignRow {
  return {
    id: "c1", name: "Осенняя акция", subject: "Скидки", status: "DRAFT", createdAt: "2026-09-01T10:00:00.000Z",
    scheduledAt: null, startedAt: null, completedAt: null, totalRecipients: 0, estimatedRecipients: null,
    queued: 0, sending: 0, sent: 0, failed: 0, uniqueOpens: 0, ...overrides,
  };
}

describe("campaign list in Russian", () => {
  const scheduled = row({ status: "SCHEDULED", scheduledAt: "2026-10-15T08:30:00.000Z", estimatedRecipients: 4850 });
  const html = inRu(<CampaignsTable rows={[scheduled, row({ id: "c2", name: "Без темы", subject: "" })]}
    onDuplicate={noop} onCancelScheduled={noop} onReschedule={noop} locale="ru-RU" timeZone="Europe/Madrid" />);

  it("has Russian column headings", () => {
    for (const text of ["Рассылка", "Статус", "Получатели", "В очереди", "Отправлено", "Ошибки", "Открытия", "Создана", "Завершена"]) {
      expect(html).toContain(text);
    }
  });

  it("names the status and the start time in Russian, with the zone", () => {
    expect(html).toContain(">Запланирована<");
    expect(html).toContain("Запланирована на");
    expect(html).toMatch(/15 окт\. 2026 г\., 10:30 (GMT\+2|CEST)/);
  });

  it("labels its buttons in Russian", () => {
    expect(html).toContain('aria-label="Отменить запланированную рассылку: Осенняя акция"');
    expect(html).toContain('aria-label="Дублировать рассылку: Осенняя акция"');
    expect(html).toContain(">Отменить<");
    expect(html).toContain(">Дублировать<");
  });

  it("explains the estimate in Russian, and writes the number the Russian way", () => {
    expect(html).toMatch(/title="Оценка\./);
    expect(html).toMatch(/≈ 4\s850/);
    expect(html).toContain("Без темы");
  });

  it("has no English left in it", () => {
    expect(html).not.toMatch(/Campaign|Status|Recipients|Duplicate|Scheduled for|No subject/);
  });
});

describe("cancel dialog in Russian", () => {
  const html = inRu(
    <CancelScheduledDialog campaign={{ id: "c1", name: "Осенняя акция", scheduledAt: "2026-10-15T08:30:00.000Z" }}
      onClose={noop} onCancelled={noop} onStale={noop} locale="ru-RU" timeZone="Europe/Madrid" />,
  );

  it("asks in Russian, naming the campaign and the time", () => {
    expect(html).toContain("Отменить запланированную рассылку?");
    expect(html).toMatch(/Осенняя акция<\/strong> запланирована на <strong>/);
    expect(html).toContain("Ваш часовой пояс: Europe/Madrid (UTC+02:00)");
  });

  it("says plainly what cancelling means, and offers two clear buttons", () => {
    expect(html).toContain("Если отменить, письма не будут отправлены никому.");
    expect(html).toContain("Это нельзя отменить");
    expect(html).toMatch(/data-autofocus[^>]*>Оставить в плане</);
    expect(html).toContain(">Отменить рассылку<");
    expect(html).toContain('aria-label="Закрыть"');
  });

  it("words the fallback failure message in the language on screen", async () => {
    renderToStaticMarkup(<LocaleProvider locale="ru"><span /></LocaleProvider>);
    vi.stubGlobal("fetch", vi.fn(async () => { throw "offline"; }));
    expect(await requestCancelScheduled("c1")).toEqual({ ok: false, stale: false, message: "Не удалось отменить рассылку" });
    vi.unstubAllGlobals();
  });
});

describe("campaign page in Russian", () => {
  it("has Russian filters, buttons and the back link", () => {
    const html = inRu(<CampaignReport campaignId="c1" initialStatus="SCHEDULED" onStatusChange={noop} />);
    expect(html).toContain("Отменить запланированную отправку");
    expect(html).toContain('placeholder="Поиск по адресу…"');
    expect(html).toContain('aria-label="Фильтр по статусу"');
    expect(html).toContain("Все статусы");
    expect(html).toContain(">В очереди</option>");
    expect(html).toContain("Открытия измеряются отслеживающим пикселем");
    expect(html).not.toMatch(/Search|Filter|All statuses|Opens are measured/);
  });

  it("has Russian buttons for a paused campaign", () => {
    const html = inRu(<CampaignReport campaignId="c1" initialStatus="PAUSED" onStatusChange={noop} />);
    expect(html).toContain(">Возобновить<");
    expect(html).toContain(">Отменить<");
  });

  it("has a Russian back link and status", () => {
    const html = inRu(<CampaignDetail
      initial={{
        id: "c1", name: "Осенняя акция", subject: "", fromName: null, fromEmail: null, replyTo: null, contentHtml: "",
        textBody: null, textBodyIsCustom: false, status: "COMPLETED", totalRecipients: 0, createdAt: "2026-09-01T10:00:00.000Z",
        scheduledAt: null, startedAt: null, completedAt: null,
      }}
      initialListIds={[]} />);
    expect(html).toContain("← Все рассылки");
    expect(html).toContain(">Завершена<");
  });
});
