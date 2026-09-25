"use client";

import { useEffect } from "react";
import { useT } from "@/i18n/client";

/**
 * The fallback for a page that throws while rendering. (In this version of Next the
 * recovery callback is called `retry`.)
 */
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const { t } = useT();
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-md p-6 text-center">
        <h1 className="text-lg font-semibold">{t("crash.title")}</h1>
        <p className="hint mt-2">{t("crash.body")}</p>
        <button className="btn btn-primary mt-4" onClick={() => retry()}>{t("crash.retry")}</button>
      </div>
    </main>
  );
}
