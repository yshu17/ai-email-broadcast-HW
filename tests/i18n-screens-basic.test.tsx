import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The plain screens (dashboard, new campaign, login), rendered in both languages.
 * Server components read the language through `getLocale()`, which is stubbed here;
 * client components read it from the provider.
 */
const language = vi.hoisted(() => ({ locale: "en" as "ru" | "en" }));

vi.mock("@/i18n/server", () => ({
  getLocale: async () => language.locale,
  getApiLocale: async () => language.locale,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
  usePathname: () => "/",
}));
vi.mock("@/lib/auth", () => ({ getSessionUser: async () => null }));

import { sql } from "@/lib/db";
import { LocaleProvider } from "@/i18n/client";
import DashboardPage from "@/app/(admin)/page";
import NewCampaignPage from "@/app/(admin)/campaigns/new/page";
import NewCampaignForm from "@/app/(admin)/campaigns/new/NewCampaignForm";
import LoginForm from "@/app/login/LoginForm";
import Nav from "@/components/Nav";
import { resetDatabase } from "./helpers";

beforeEach(async () => { language.locale = "en"; await resetDatabase(); });
afterAll(async () => { await sql.end(); });

const client = (locale: "ru" | "en", node: React.ReactNode) =>
  renderToStaticMarkup(<LocaleProvider locale={locale}>{node}</LocaleProvider>);

describe("dashboard", () => {
  it("reads in English as it always did", async () => {
    const html = renderToStaticMarkup(await DashboardPage());
    for (const text of ["Dashboard", "New campaign", "Sent (last 7 days)", "Current queue", "Open rate", "Getting started"]) {
      expect(html).toContain(text);
    }
  });

  it("reads in Russian", async () => {
    language.locale = "ru";
    const html = renderToStaticMarkup(await DashboardPage());
    for (const text of ["Главная", "Новая рассылка", "Отправлено (за 7 дней)", "Очередь сейчас", "Доля открытий", "С чего начать"]) {
      expect(html).toContain(text);
    }
    expect(html).not.toMatch(/Dashboard|Getting started|Open rate/);
  });

  it("writes numbers the Russian way", async () => {
    language.locale = "ru";
    process.env.SMTP_MAX_EMAILS_PER_HOUR = "5000";
    const html = renderToStaticMarkup(await DashboardPage());
    // 5000 at the 0.95 safety factor is 4750: "4 750" with a (non-breaking) space, not "4,750" or "4750".
    expect(html).toMatch(/из 4\s750/);
  });
});

describe("new campaign", () => {
  it("has a Russian page title and form", async () => {
    language.locale = "ru";
    const page = renderToStaticMarkup(await NewCampaignPage());
    expect(page).toContain("Новая рассылка");

    const form = client("ru", <NewCampaignForm />);
    for (const text of ["Внутреннее название", "Видно только вам.", "Тема письма", "Создать черновик"]) {
      expect(form).toContain(text);
    }
    expect(form).toContain('placeholder="Октябрьская рассылка"');
  });

  it("keeps the English form", () => {
    const form = client("en", <NewCampaignForm />);
    for (const text of ["Internal name", "Only you see this.", "Email subject", "Create draft"]) expect(form).toContain(text);
  });
});

describe("sign-in and navigation", () => {
  it("has a Russian sign-in form", () => {
    const html = client("ru", <LoginForm />);
    for (const text of ["Эл. почта", "Пароль", "Войти"]) expect(html).toContain(text);
  });

  it("has a Russian menu, with the language switcher in it", () => {
    const html = client("ru", <Nav email="admin@example.test" />);
    for (const text of ["Главная", "Контакты", "Списки", "Рассылки", "Отписавшиеся", "Настройки", "Выйти"]) {
      expect(html).toContain(text);
    }
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>RU</);
  });

  it("keeps the English menu", () => {
    const html = client("en", <Nav email="admin@example.test" />);
    for (const text of ["Dashboard", "Contacts", "Lists", "Campaigns", "Unsubscribed", "Settings", "Sign out"]) {
      expect(html).toContain(text);
    }
  });
});
