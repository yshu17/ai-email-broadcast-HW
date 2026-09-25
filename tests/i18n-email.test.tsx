import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The words that go into an email (the unsubscribe footer, the plain-text line) and
 * the public unsubscribe page. Neither follows the admin's on-screen language: mail
 * follows EMAIL_LANGUAGE, and the page follows the visitor's own browser.
 */
const request = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  acceptLanguage: undefined as string | undefined,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "locale" && request.cookie ? { value: request.cookie } : undefined) }),
  headers: async () => new Headers(request.acceptLanguage ? { "accept-language": request.acceptLanguage } : {}),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));

import { sql } from "@/lib/db";
import { buildMessage } from "@/lib/message-builder";
import { emailLocale } from "@/i18n/locale";
import { getPublicLocale } from "@/i18n/server";
import UnsubscribePage from "@/app/unsubscribe/[token]/page";
import { addRecipient, createCampaign, resetDatabase, suppress } from "./helpers";

beforeEach(async () => {
  request.cookie = undefined;
  request.acceptLanguage = undefined;
  await resetDatabase();
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => { await sql.end(); });

const baseUrl = "https://mail.example.test";
const campaign = { subject: "Hi", compiledHtml: "<p>Hello</p>" };
const recipient = { email: "a@example.test", unsubscribeToken: "TOKEN0123456789ABCDEF" };

describe("which language an email speaks", () => {
  it("is Russian unless EMAIL_LANGUAGE says otherwise", () => {
    expect(emailLocale()).toBe("ru");
    vi.stubEnv("EMAIL_LANGUAGE", "en");
    expect(emailLocale()).toBe("en");
    vi.stubEnv("EMAIL_LANGUAGE", "EN");
    expect(emailLocale()).toBe("en");
    vi.stubEnv("EMAIL_LANGUAGE", "klingon");
    expect(emailLocale()).toBe("ru");
  });

  it("writes the footer and the plain-text line in Russian by default", () => {
    const message = buildMessage({ campaign, recipient, baseUrl });

    expect(message.html).toContain("Вы получаете это письмо, потому что подписались на нашу рассылку.");
    expect(message.html).toContain(">Отписаться<");
    expect(message.text).toContain(`Отписаться: ${baseUrl}/unsubscribe/TOKEN0123456789ABCDEF`);
    expect(message.html).not.toContain("You are receiving this email");
  });

  it("writes them in English as it always did when EMAIL_LANGUAGE=en", () => {
    vi.stubEnv("EMAIL_LANGUAGE", "en");

    const message = buildMessage({ campaign, recipient, baseUrl });

    expect(message.html).toContain("You are receiving this email because you subscribed to our list.");
    expect(message.html).toContain(">Unsubscribe<");
    expect(message.text).toContain(`Unsubscribe: ${baseUrl}/unsubscribe/TOKEN0123456789ABCDEF`);
  });

  it("does not depend on the admin's screen language: only the environment and an explicit option decide", () => {
    expect(buildMessage({ campaign, recipient, baseUrl, language: "en" }).html).toContain("You are receiving this email");
    expect(buildMessage({ campaign, recipient, baseUrl, language: "ru" }).html).toContain("Вы получаете это письмо");
  });

  it("leaves everything the author wrote alone, and adds no footer when they placed the link themselves", () => {
    const own = buildMessage({
      campaign: { subject: "Привет, {{firstName}}", compiledHtml: "<p>Пока <a href=\"{{unsubscribeUrl}}\">отписка</a></p>" },
      recipient: { ...recipient, firstName: "Аня" }, baseUrl,
    });

    expect(own.subject).toBe("Привет, Аня");
    expect(own.html).not.toContain("Вы получаете это письмо");
    expect(own.html).toContain(">отписка<");
  });

  it("keeps the unsubscribe headers exactly as they were", () => {
    const message = buildMessage({ campaign, recipient, baseUrl });

    expect(message.headers["List-Unsubscribe"]).toBe(`<${baseUrl}/api/unsubscribe/TOKEN0123456789ABCDEF>`);
    expect(message.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });
});

describe("which language the public unsubscribe page speaks", () => {
  it("follows the visitor's choice, then their browser, then the mail's language", async () => {
    request.cookie = "en";
    request.acceptLanguage = "ru-RU,ru;q=0.9";
    expect(await getPublicLocale()).toBe("en");

    request.cookie = undefined;
    expect(await getPublicLocale()).toBe("ru");

    request.acceptLanguage = "en-GB,en;q=0.9";
    expect(await getPublicLocale()).toBe("en");

    request.acceptLanguage = "de,fr";
    vi.stubEnv("EMAIL_LANGUAGE", "en");
    expect(await getPublicLocale()).toBe("en");
    vi.stubEnv("EMAIL_LANGUAGE", "ru");
    expect(await getPublicLocale()).toBe("ru");
  });

  const page = async (token: string) => renderToStaticMarkup(await UnsubscribePage({ params: Promise.resolve({ token }) }));

  it("says an unknown link is not recognised, in the visitor's language", async () => {
    request.acceptLanguage = "ru";
    const ru = await page("nope");
    expect(ru).toContain("Ссылка не распознана");
    expect(ru).toContain("недействительна или устарела");

    request.acceptLanguage = "en";
    expect(await page("nope")).toContain("Link not recognised");
  });

  it("asks for confirmation in Russian, naming the address", async () => {
    request.acceptLanguage = "ru";
    const id = await createCampaign();
    await addRecipient(id, "reader@example.test", { unsubscribeToken: "TOKEN-CONFIRM-0123456789" });

    const html = await page("TOKEN-CONFIRM-0123456789");

    expect(html).toContain(">Отписка<");
    expect(html).toMatch(/Перестать отправлять письма на адрес <strong>reader@example\.test<\/strong>\?/);
    expect(html).toContain("Да, отписать меня");
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>RU</);
    expect(html).not.toMatch(/Unsubscribe|Yes, unsubscribe/);
  });

  it("asks for confirmation in English when the visitor's browser is English", async () => {
    request.acceptLanguage = "en-US";
    const id = await createCampaign();
    await addRecipient(id, "reader@example.test", { unsubscribeToken: "TOKEN-CONFIRM-0123456789" });

    const html = await page("TOKEN-CONFIRM-0123456789");

    expect(html).toContain(">Unsubscribe<");
    expect(html).toContain("Yes, unsubscribe me");
  });

  it("confirms an address that is already unsubscribed", async () => {
    request.acceptLanguage = "ru";
    const id = await createCampaign();
    await addRecipient(id, "gone@example.test", { unsubscribeToken: "TOKEN-DONE-0123456789ABC" });
    await suppress("gone@example.test");

    const html = await page("TOKEN-DONE-0123456789ABC");

    expect(html).toContain("Вы отписались");
    expect(html).toMatch(/На адрес <strong>gone@example\.test<\/strong> мы больше не будем отправлять письма\./);
  });
});
