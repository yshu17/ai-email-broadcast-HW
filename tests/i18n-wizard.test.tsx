import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));

import { LocaleProvider } from "@/i18n/client";
import { describeDuration } from "@/i18n/format";
import { Rich } from "@/i18n/rich";
import { formatDuration } from "@/lib/rate-limit";
import CampaignWizard, {
  ComposeStep, RecipientsStep, SendStep, type CampaignDraft,
} from "@/app/(admin)/campaigns/[id]/CampaignWizard";

const originalTz = process.env.TZ;
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

const inRu = (node: React.ReactNode) => renderToStaticMarkup(<LocaleProvider locale="ru">{node}</LocaleProvider>);
const noop = () => undefined;

const draft: CampaignDraft = {
  id: "c1", name: "Осенняя акция", subject: "Скидки", fromName: "Магазин", fromEmail: "shop@example.test", replyTo: null,
  contentHtml: "<p>Привет</p>", textBody: null, textBodyIsCustom: false, status: "DRAFT", totalRecipients: 0,
  createdAt: "2026-09-01T10:00:00.000Z", scheduledAt: null, startedAt: null, completedAt: null,
};
const audience = {
  totalMemberships: 5, uniqueContacts: 5, duplicatesRemoved: 1, suppressed: 2, finalRecipients: 4850,
  maxEmailsPerHour: 5000, estimatedDuration: "about 1 hour", estimatedSeconds: 3900,
};

describe("how long a send takes, in words", () => {
  it.each([0, 20, 59, 61, 90, 119, 120, 300, 3540, 3600, 3660, 3900, 7200, 7260, 36000, 90000])(
    "reads in English exactly as the server's formatDuration does for %d seconds",
    (seconds) => {
      expect(describeDuration(seconds, "en")).toBe(formatDuration(seconds));
    },
  );

  it.each([
    [0, "меньше минуты"], [30, "около минуты"], [120, "около 2 минут"], [300, "около 5 минут"],
    [21 * 60, "около 21 минуты"], [3600, "около 1 часа"], [7200, "около 2 часов"], [5 * 3600, "около 5 часов"],
    [21 * 3600, "около 21 часа"], [3900, "около 1 ч 5 мин"],
  ])("reads in Russian for %d seconds", (seconds, expected) => {
    expect(describeDuration(seconds, "ru")).toBe(expected);
  });
});

describe("Rich (bold parts of a translated sentence)", () => {
  it("bolds what is between <b> markers and nothing else", () => {
    expect(renderToStaticMarkup(<Rich text="Отправка <b>4 850</b> писем в <b>10:30</b>." />))
      .toBe("Отправка <strong>4 850</strong> писем в <strong>10:30</strong>.");
  });

  it("never interprets anything as HTML", () => {
    expect(renderToStaticMarkup(<Rich text="a <b>x</b> <script>alert(1)</script>" />))
      .toBe("a <strong>x</strong> &lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("passes plain text through", () => {
    expect(renderToStaticMarkup(<Rich text="Just text" />)).toBe("Just text");
  });
});

describe("the wizard in Russian", () => {
  it("has Russian step buttons", () => {
    const html = inRu(<CampaignWizard initial={draft} initialListIds={[]} onQueued={noop} onScheduled={noop} />);
    for (const text of ["1. Содержимое", "2. Получатели", "3. Просмотр", "4. Отправка", "Продолжить", "Сохранено"]) {
      expect(html).toContain(text);
    }
    expect(html).not.toMatch(/Compose|Continue|Saved/);
  });

  it("has a Russian compose step", () => {
    const html = inRu(<ComposeStep draft={draft} set={noop} />);
    for (const text of [
      "Внутреннее название", "Тема", "Имя отправителя", "Адрес отправителя", "Адрес для ответов (необязательно)",
      "Содержимое письма", "Переменные:", "Написать свою текстовую версию",
    ]) {
      expect(html).toContain(text);
    }
    expect(html).toContain("{{firstName}}"); // the variable names are the product's, not translated
    expect(html).not.toMatch(/Internal name|Sender name|Email content|Variables/);
  });

  it("has a Russian recipients step", () => {
    const html = inRu(<RecipientsStep lists={[{ id: "l1", name: "Клиенты", contactCount: 5 }]} listIds={["l1"]} toggleList={noop} audience={audience} />);
    for (const text of ["Выберите списки", "Аудитория", "Во всех списках", "Дубликатов убрано", "Отписались", "Получат", "ровно один раз"]) {
      expect(html).toContain(text);
    }
  });

  it("has an empty-lists hint in Russian", () => {
    expect(inRu(<RecipientsStep lists={[]} listIds={[]} toggleList={noop} audience={null} />))
      .toContain("Списков пока нет");
  });

  describe("the last step", () => {
    const step = (plan: { mode: "now" | "schedule"; date: string; time: string; occurrence?: "first" | "second" }) =>
      inRu(<SendStep draft={draft} audience={audience} lists={[{ id: "l1", name: "Клиенты", contactCount: 5 }]}
        plan={plan} onPlanChange={noop} onQueued={noop} onScheduled={noop} onError={noop} />);

    it("asks 'when to send' in Russian, with 'send now' chosen", () => {
      const html = step({ mode: "now", date: "", time: "" });
      expect(html).toContain("Когда отправить?");
      expect(html).toMatch(/<input[^>]*name="sendMode"[^>]*checked[^>]*>\s*Отправить сейчас/);
      expect(html).toContain("Поставить в очередь");
      expect(html).toMatch(/Отправка начнётся<\/dt><dd[^>]*>Сразу</);
    });

    it("words the summary and the duration in Russian, with Russian numbers", () => {
      const html = step({ mode: "now", date: "", time: "" });
      for (const text of ["Проверьте перед отправкой", "Уникальных получателей", "Ожидаемая длительность", "Отписались, пропущены"]) {
        expect(html).toContain(text);
      }
      expect(html).toMatch(/около 1 ч 5 мин при 5\s000 писем в час/);
    });

    it("shows the schedule fields, the time zone and the help in Russian", () => {
      process.env.TZ = "Europe/Madrid";
      const html = step({ mode: "schedule", date: "", time: "" });
      expect(html).toContain("Запланировать рассылку");
      expect(html).toContain(">Дата<");
      expect(html).toContain(">Время<");
      expect(html).toMatch(/Часовой пояс: Europe\/Madrid \(UTC\+0[12]:00\)\. Это момент начала отправки/);
      expect(html).toMatch(/Отправка начнётся<\/dt><dd[^>]*>Пока не выбрано</);
    });

    it("words validation messages in Russian, beside the right field", () => {
      const past = step({ mode: "schedule", date: "2020-01-01", time: "10:00" });
      expect(past).toMatch(/id="scheduleDateError"[^>]*>Время отправки должно быть в будущем\./);
    });

    it("words the daylight-saving problems in Russian", () => {
      process.env.TZ = "Europe/Madrid";
      const lastSunday = (month: number) => {
        for (let day = 31; day >= 1; day -= 1) {
          const d = new Date(Date.UTC(2099, month - 1, day));
          if (d.getUTCMonth() === month - 1 && d.getUTCDay() === 0) return `2099-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        }
        throw new Error("no Sunday");
      };
      expect(step({ mode: "schedule", date: lastSunday(3), time: "02:30" })).toContain("Этого времени нет в вашем часовом поясе");
      const twice = step({ mode: "schedule", date: lastSunday(10), time: "02:30" });
      expect(twice).toContain("Это время встречается дважды");
      expect(twice).toContain("Какое из двух значений 02:30 вы имеете в виду?");
      expect(twice).toContain("первое, до перевода часов назад");
      expect(twice).toContain("второе, после перевода часов назад");
    });

    it("has no English left on the schedule form", () => {
      process.env.TZ = "Europe/Madrid";
      const html = step({ mode: "schedule", date: "2099-07-15", time: "10:30" });
      expect(html).not.toMatch(/Send now|Schedule|Time zone|When to send|Confirm before|Sending starts/);
    });
  });
});
