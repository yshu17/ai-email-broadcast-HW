"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { Alert, EmptyState, Modal, Spinner, api, useLoader } from "@/components/ui";
import { useT } from "@/i18n/client";

type List = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  contactCount: number;
};

export default function ListsClient() {
  const { t, formatDate, formatNumber } = useT();
  const [editing, setEditing] = useState<List | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", description: "" });
  const [busy, setBusy] = useState(false);

  const fetchLists = useCallback(async () => {
    const data = await api<{ lists: List[] }>("/api/lists");
    return data.lists;
  }, []);

  const { data: lists, error, reload, setError } = useLoader(fetchLists);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        await api(`/api/lists/${editing.id}`, { method: "PATCH", body: JSON.stringify(form) });
      } else {
        await api("/api/lists", { method: "POST", body: JSON.stringify(form) });
      }
      setEditing(null);
      setCreating(false);
      setForm({ name: "", description: "" });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (list: List) => {
    if (!confirm(t("lists.confirmDelete", { name: list.name }))) return;
    try {
      await api(`/api/lists/${list.id}`, { method: "DELETE" });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.deleteFailed"));
    }
  };

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t("nav.lists")}</h1>
        <button className="btn btn-primary" onClick={() => { setForm({ name: "", description: "" }); setCreating(true); }}>
          {t("lists.new")}
        </button>
      </div>

      {error ? <Alert kind="error">{error}</Alert> : null}

      {lists === null ? (
        <Spinner />
      ) : lists.length === 0 ? (
        <EmptyState title={t("lists.empty.title")}>
          {t("lists.empty.hint")}
        </EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {lists.map((list) => (
            <div key={list.id} className="card flex flex-col p-4">
              <Link href={`/lists/${list.id}`} className="font-medium hover:underline">{list.name}</Link>
              {list.description ? <p className="hint mt-1 line-clamp-2">{list.description}</p> : null}
              <p className="mt-2 text-2xl font-semibold tabular-nums">{formatNumber(list.contactCount)}</p>
              <p className="hint">{t("lists.contactsCreated", { date: formatDate(list.createdAt) })}</p>
              <div className="mt-3 flex gap-2">
                <Link className="btn px-2 py-1 text-xs" href={`/lists/${list.id}`}>{t("common.open")}</Link>
                <button className="btn px-2 py-1 text-xs"
                  onClick={() => { setEditing(list); setForm({ name: list.name, description: list.description ?? "" }); }}>
                  {t("lists.rename")}
                </button>
                <button className="btn btn-danger px-2 py-1 text-xs" onClick={() => remove(list)}>{t("common.delete")}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={creating || editing !== null}
        title={editing ? t("lists.renameTitle") : t("lists.new")}
        onClose={() => { setCreating(false); setEditing(null); }}
      >
        <form onSubmit={save} className="grid gap-3">
          <div>
            <label className="label" htmlFor="listName">{t("lists.name")}</label>
            <input id="listName" className="input" required value={form.name} autoFocus
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <label className="label" htmlFor="listDesc">{t("lists.description")}</label>
            <input id="listDesc" className="input" value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? t("common.saving") : editing ? t("common.save") : t("common.create")}
          </button>
        </form>
      </Modal>
    </div>
  );
}
