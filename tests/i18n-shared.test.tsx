import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LocaleProvider } from "@/i18n/client";
import { Modal, ScheduledTime, Spinner, StatusBadge, api, formatDate } from "@/components/ui";

afterEach(() => vi.unstubAllGlobals());

const inLocale = (locale: "ru" | "en", node: React.ReactNode) =>
  renderToStaticMarkup(<LocaleProvider locale={locale}>{node}</LocaleProvider>);

describe("status badges", () => {
  const RU: Record<string, string> = {
    DRAFT: "Черновик", SCHEDULED: "Запланирована", QUEUED: "В очереди", SENDING: "Отправляется",
    PAUSED: "На паузе", COMPLETED: "Завершена", CANCELLED: "Отменена",
    SENT: "Отправлено", FAILED: "Ошибка", SUPPRESSED: "Отписан",
  };

  it.each(Object.keys(RU))("shows %s in Russian", (status) => {
    expect(inLocale("ru", <StatusBadge status={status} />)).toContain(`>${RU[status]}<`);
  });

  it.each(Object.keys(RU))("keeps showing %s as it always did in English", (status) => {
    expect(inLocale("en", <StatusBadge status={status} />)).toContain(`>${status}<`);
  });

  it("shows a status it does not know as it is, in either language", () => {
    expect(inLocale("ru", <StatusBadge status="WEIRD" />)).toContain(">WEIRD<");
  });

  it("does not change the colour with the language", () => {
    const colour = (html: string) => /class="badge (.*?)"/.exec(html)?.[1];
    expect(colour(inLocale("ru", <StatusBadge status="SCHEDULED" />))).toBe(colour(inLocale("en", <StatusBadge status="SCHEDULED" />)));
  });
});

describe("shared pieces", () => {
  it("Spinner says Loading… in the language on screen", () => {
    expect(inLocale("en", <Spinner />)).toContain("Loading…");
    expect(inLocale("ru", <Spinner />)).toContain("Загрузка…");
  });

  it("a dialog's close button is named in the language on screen", () => {
    const dialog = <Modal open title="x" onClose={() => undefined}>body</Modal>;
    expect(inLocale("en", dialog)).toContain('aria-label="Close"');
    expect(inLocale("ru", dialog)).toContain('aria-label="Закрыть"');
  });

  it("dates follow the language, and stay '—' when there is nothing to show", () => {
    const at = "2026-10-15T08:30:00.000Z";
    expect(formatDate(at, "en")).toMatch(/Oct/);
    expect(formatDate(at, "ru")).toMatch(/окт/);
    expect(formatDate(null, "ru")).toBe("—");
    expect(formatDate("garbage", "ru")).toBe("—");
  });

  it("a scheduled moment is worded in the language on screen, in the zone asked for", () => {
    const at = "2026-10-15T08:30:00.000Z";
    const ru = inLocale("ru", <ScheduledTime value={at} timeZone="Europe/Madrid" />);
    const en = inLocale("en", <ScheduledTime value={at} timeZone="Europe/Madrid" />);
    expect(ru).toMatch(/15 окт\. 2026 г\., 10:30/);
    expect(en).toMatch(/Oct 15, 2026, 10:30/);
  });
});

describe("api()", () => {
  const stub = (body: unknown, status: number, contentType = "application/json") => {
    const fetchFake = vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status, headers: { "content-type": contentType },
    }));
    vi.stubGlobal("fetch", fetchFake);
    return fetchFake;
  };

  it("tells the server which language the page is in, so error texts come back in it", async () => {
    inLocale("ru", <span />); // rendering the provider is what records the language
    const fetchFake = stub({ ok: true }, 200);

    await api("/api/x");

    const [, init] = fetchFake.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["x-locale"]).toBe("ru");
  });

  it("follows the language when it changes", async () => {
    inLocale("ru", <span />);
    inLocale("en", <span />);
    const fetchFake = stub({ ok: true }, 200);

    await api("/api/x");

    const [, init] = fetchFake.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["x-locale"]).toBe("en");
  });

  it("passes the server's own (already translated) message through", async () => {
    inLocale("ru", <span />);
    stub({ error: "Рассылка не найдена" }, 404);

    await expect(api("/api/x")).rejects.toMatchObject({ status: 404, message: "Рассылка не найдена" });
  });

  it("words a failure with no message in the language on screen", async () => {
    inLocale("ru", <span />);
    stub("<html>bad gateway</html>", 502, "text/html");
    await expect(api("/api/x")).rejects.toMatchObject({ status: 502, message: "Запрос не выполнен (502)" });

    inLocale("en", <span />);
    stub("<html>bad gateway</html>", 502, "text/html");
    await expect(api("/api/x")).rejects.toMatchObject({ status: 502, message: "Request failed (502)" });
  });
});
