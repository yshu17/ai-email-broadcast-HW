"use client";

import { useCallback, useState } from "react";
import { Alert, EmptyState, Modal, Spinner, api, useDebounced, useLoader } from "@/components/ui";
import { useT } from "@/i18n/client";

export type ContactRow = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  createdAt: string;
};

/**
 * Shared contacts table. With a `listId` it shows and edits that list's
 * membership; without one it manages the global address book.
 */
export default function ContactsTable({ listId, reloadKey = 0 }: { listId?: string; reloadKey?: number }) {
  const { t, formatDate } = useT();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<ContactRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ email: "", firstName: "", lastName: "" });
  const [busy, setBusy] = useState(false);

  const pageSize = 50;

  const fetchContacts = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (listId) params.set("listId", listId);
    // reloadKey is part of the identity on purpose: a parent bumps it after an
    // import so this refetches.
    void reloadKey;
    const data = await api<{ contacts: ContactRow[]; total: number }>(`/api/contacts?${params}`);
    setSelected(new Set());
    return data;
  }, [page, debouncedSearch, listId, reloadKey]);

  const { data, error, reload, setError } = useLoader(fetchContacts);
  const rows = data?.contacts ?? null;
  const total = data?.total ?? 0;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        await api(`/api/contacts/${editing.id}`, { method: "PATCH", body: JSON.stringify(form) });
      } else {
        await api("/api/contacts", { method: "POST", body: JSON.stringify({ ...form, listId: listId ?? null }) });
      }
      setEditing(null);
      setAdding(false);
      setForm({ email: "", firstName: "", lastName: "" });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const bulkDelete = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    const question = listId
      ? t("contacts.confirmRemoveFromList", { count: ids.length })
      : t("contacts.confirmDeleteAll", { count: ids.length });
    if (!confirm(question)) return;
    try {
      await api("/api/contacts", {
        method: "DELETE",
        body: JSON.stringify({ ids, listId: listId ?? null }),
      });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.deleteFailed"));
    }
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allOnPageSelected = rows !== null && rows.length > 0 && rows.every((r) => selected.has(r.id));
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="grid gap-3">
      {error ? <Alert kind="error">{error}</Alert> : null}

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input max-w-xs"
          placeholder={t("contacts.searchPlaceholder")}
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          aria-label={t("contacts.searchLabel")}
        />
        <button className="btn" onClick={() => { setForm({ email: "", firstName: "", lastName: "" }); setAdding(true); }}>
          {t("contacts.add")}
        </button>
        {selected.size > 0 ? (
          <button className="btn btn-danger" onClick={bulkDelete}>
            {listId
              ? t("contacts.removeFromList", { count: selected.size })
              : t("contacts.deleteSelected", { count: selected.size })}
          </button>
        ) : null}
        <span className="hint ml-auto tabular-nums">{t("contacts.total", { count: total })}</span>
      </div>

      {rows === null ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState title={search ? t("contacts.noMatches") : t("contacts.none")}>
          {search ? t("contacts.tryDifferent") : t("contacts.addOrImport")}
        </EmptyState>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left" style={{ color: "var(--color-muted)" }}>
                <th className="w-10 px-3 py-2">
                  <input type="checkbox" checked={allOnPageSelected} aria-label={t("contacts.selectAll")}
                    onChange={(e) =>
                      setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())
                    } />
                </th>
                <th className="px-3 py-2 font-medium">{t("common.email")}</th>
                <th className="px-3 py-2 font-medium">{t("common.firstName")}</th>
                <th className="px-3 py-2 font-medium">{t("common.lastName")}</th>
                <th className="hidden px-3 py-2 font-medium sm:table-cell">{t("contacts.col.added")}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b last:border-0">
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggle(row.id)}
                      aria-label={t("contacts.selectRow", { email: row.email })} />
                  </td>
                  <td className="px-3 py-2 break-all">{row.email}</td>
                  <td className="px-3 py-2">{row.firstName ?? "—"}</td>
                  <td className="px-3 py-2">{row.lastName ?? "—"}</td>
                  <td className="hidden px-3 py-2 sm:table-cell" style={{ color: "var(--color-muted)" }}>
                    {formatDate(row.createdAt)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button className="btn px-2 py-1 text-xs"
                      onClick={() => {
                        setEditing(row);
                        setForm({ email: row.email, firstName: row.firstName ?? "", lastName: row.lastName ?? "" });
                      }}>
                      {t("common.edit")}
                    </button>
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

      <Modal
        open={adding || editing !== null}
        title={editing ? t("contacts.edit") : t("contacts.add")}
        onClose={() => { setAdding(false); setEditing(null); }}
      >
        <form onSubmit={submit} className="grid gap-3">
          <div>
            <label className="label" htmlFor="cEmail">{t("common.email")}</label>
            <input id="cEmail" className="input" type="email" required autoFocus value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="cFirst">{t("common.firstName")}</label>
              <input id="cFirst" className="input" value={form.firstName}
                onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} />
            </div>
            <div>
              <label className="label" htmlFor="cLast">{t("common.lastName")}</label>
              <input id="cLast" className="input" value={form.lastName}
                onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} />
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? t("common.saving") : t("common.save")}
            </button>
            {editing ? (
              <button type="button" className="btn btn-danger"
                onClick={async () => {
                  if (!confirm(t("contacts.confirmDeleteOne"))) return;
                  await api(`/api/contacts/${editing.id}`, { method: "DELETE" });
                  setEditing(null);
                  reload();
                }}>
                {t("common.delete")}
              </button>
            ) : null}
          </div>
        </form>
      </Modal>
    </div>
  );
}
