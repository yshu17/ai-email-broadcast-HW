"use client";

import { useCallback, useState } from "react";
import { Alert, EmptyState, Spinner, api, useDebounced, useLoader } from "@/components/ui";
import { useT } from "@/i18n/client";
import { hasMessage, type MessageKey } from "@/i18n/translate";

type Suppression = {
  id: string;
  email: string;
  reason: string;
  note: string | null;
  createdAt: string;
};

export default function SuppressionsClient() {
  const { t, formatDate } = useT();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const pageSize = 50;

  const fetchSuppressions = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (debouncedSearch) params.set("search", debouncedSearch);
    return api<{ suppressions: Suppression[]; total: number }>(`/api/suppressions?${params}`);
  }, [page, debouncedSearch]);

  const { data, error, reload, setError } = useLoader(fetchSuppressions);
  const rows = data?.suppressions ?? null;
  const total = data?.total ?? 0;

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/suppressions", { method: "POST", body: JSON.stringify({ email }) });
      setEmail("");
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("suppressions.addFailed"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: Suppression) => {
    if (!confirm(t("suppressions.confirmRemove", { email: row.email }))) return;
    try {
      await api("/api/suppressions", { method: "DELETE", body: JSON.stringify({ email: row.email }) });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("suppressions.removeFailed"));
    }
  };

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const reasonLabel = (reason: string) => {
    const key = `suppressions.reason.${reason}`;
    return hasMessage(key) ? t(key as MessageKey) : reason;
  };

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-xl font-semibold">{t("suppressions.title")}</h1>
        <p className="hint mt-1">{t("suppressions.intro")}</p>
      </div>

      {error ? <Alert kind="error">{error}</Alert> : null}

      <form onSubmit={add} className="card flex flex-wrap items-end gap-2 p-4">
        <div className="min-w-56 flex-1">
          <label className="label" htmlFor="supEmail">{t("suppressions.manual")}</label>
          <input id="supEmail" className="input" type="email" required value={email}
            onChange={(e) => setEmail(e.target.value)} placeholder="person@example.com" />
        </div>
        <button className="btn btn-primary" type="submit" disabled={busy}>{t("common.add")}</button>
      </form>

      <input className="input max-w-xs" placeholder={t("suppressions.searchPlaceholder")} value={search}
        onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        aria-label={t("suppressions.searchLabel")} />

      {rows === null ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState title={t("suppressions.empty.title")}>
          {t("suppressions.empty.hint")}
        </EmptyState>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left" style={{ color: "var(--color-muted)" }}>
                <th className="px-3 py-2 font-medium">{t("common.email")}</th>
                <th className="px-3 py-2 font-medium">{t("suppressions.col.reason")}</th>
                <th className="px-3 py-2 font-medium">{t("suppressions.col.date")}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b last:border-0">
                  <td className="px-3 py-2 break-all">{row.email}</td>
                  <td className="px-3 py-2"><span className="badge">{reasonLabel(row.reason)}</span></td>
                  <td className="px-3 py-2" style={{ color: "var(--color-muted)" }}>{formatDate(row.createdAt)}</td>
                  <td className="px-3 py-2 text-right">
                    <button className="btn px-2 py-1 text-xs" onClick={() => remove(row)}>{t("common.remove")}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 ? (
        <div className="flex items-center justify-between">
          <button className="btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>{t("common.previous")}</button>
          <span className="hint">{t("common.page", { page, pages: pageCount })}</span>
          <button className="btn" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>{t("common.next")}</button>
        </div>
      ) : null}
    </div>
  );
}
