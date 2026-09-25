import type { Metadata } from "next";
import { LocaleProvider } from "@/i18n/client";
import { getLocale } from "@/i18n/server";
import { translate } from "@/i18n/translate";
import "./globals.css";

/** The tab title follows the visitor's language. */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return { title: translate(locale, "app.title"), description: translate(locale, "app.description") };
}

/**
 * The theme is applied before paint to avoid a flash of the wrong colours.
 * It is a plain localStorage preference with a system-preference fallback.
 */
const THEME_SCRIPT = `
try {
  var stored = localStorage.getItem('theme');
  var dark = stored ? stored === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  if (dark) document.documentElement.classList.add('dark');
} catch (e) {}
`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen antialiased">
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
