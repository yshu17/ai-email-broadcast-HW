import Link from "next/link";
import { getLocale } from "@/i18n/server";
import { translate } from "@/i18n/translate";

/** Shown for any address that does not exist, in the visitor's language. */
export default async function NotFound() {
  const locale = await getLocale();
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-md p-6 text-center">
        <h1 className="text-lg font-semibold">{translate(locale, "notFound.title")}</h1>
        <p className="hint mt-2">{translate(locale, "notFound.body")}</p>
        <Link className="btn btn-primary mt-4" href="/">{translate(locale, "notFound.home")}</Link>
      </div>
    </main>
  );
}
