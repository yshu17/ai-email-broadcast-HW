import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { getLocale } from "@/i18n/server";
import { translate } from "@/i18n/translate";
import LoginForm from "./LoginForm";

export default async function LoginPage() {
  if (await getSessionUser()) redirect("/");
  const locale = await getLocale();
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="fixed right-4 top-4"><LanguageSwitcher /></div>
      <div className="card w-full max-w-sm p-6">
        <h1 className="text-lg font-semibold">✉ {translate(locale, "app.title")}</h1>
        <p className="hint mt-1 mb-5">{translate(locale, "login.subtitle")}</p>
        <LoginForm />
      </div>
    </main>
  );
}
