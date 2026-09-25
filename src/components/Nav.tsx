"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { useT } from "@/i18n/client";
import type { MessageKey } from "@/i18n/translate";

const LINKS: { href: string; label: MessageKey }[] = [
  { href: "/", label: "nav.dashboard" },
  { href: "/contacts", label: "nav.contacts" },
  { href: "/lists", label: "nav.lists" },
  { href: "/campaigns", label: "nav.campaigns" },
  { href: "/suppressions", label: "nav.suppressions" },
  { href: "/settings", label: "nav.settings" },
];

export default function Nav({ email }: { email: string }) {
  const { t } = useT();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  /**
   * The theme lives on <html>, not in React state: reading it during render
   * would mismatch the server, and the icon can be swapped with CSS instead.
   */
  const toggleTheme = () => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      // Private browsing; the choice just won't persist.
    }
  };

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <header className="sticky top-0 z-40 border-b" style={{ backgroundColor: "var(--color-surface)" }}>
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <Link href="/" className="font-semibold tracking-tight">✉ Mailer</Link>

        {/* The row of links needs about a thousand pixels in Russian, so it appears from `lg`; below that the menu button opens the same links. */}
        <nav className="ml-4 hidden gap-1 lg:flex">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`nav-link ${isActive(link.href) ? "nav-link-active" : ""}`}
              aria-current={isActive(link.href) ? "page" : undefined}
            >
              {t(link.label)}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <LanguageSwitcher />
          <button className="btn px-2 py-1 text-xs" onClick={toggleTheme}
            title={t("nav.toggleThemeTitle")} aria-label={t("nav.toggleThemeLabel")}>
            <span className="theme-icon-light">☾</span>
            <span className="theme-icon-dark">☀</span>
          </button>
          <span className="hidden text-xs xl:inline" style={{ color: "var(--color-muted)" }}>{email}</span>
          <button
            className="btn px-2 py-1 text-xs"
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              router.push("/login");
              router.refresh();
            }}
          >
            {t("nav.signOut")}
          </button>
          <button className="btn px-2 py-1 text-xs lg:hidden" onClick={() => setOpen((o) => !o)}
            aria-expanded={open} aria-label={t("nav.menu")}>☰</button>
        </div>
      </div>

      {open ? (
        <nav className="grid gap-1 border-t px-4 py-2 lg:hidden">
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href} onClick={() => setOpen(false)}
              className={`nav-link py-2 ${isActive(link.href) ? "nav-link-active" : ""}`}
              aria-current={isActive(link.href) ? "page" : undefined}>
              {t(link.label)}
            </Link>
          ))}
        </nav>
      ) : null}
    </header>
  );
}
