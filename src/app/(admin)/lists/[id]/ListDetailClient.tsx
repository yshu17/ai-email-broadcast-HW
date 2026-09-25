"use client";

import Link from "next/link";
import { useState } from "react";
import ContactsTable from "@/components/ContactsTable";
import ImportPanel from "@/components/ImportPanel";
import { useT } from "@/i18n/client";

export default function ListDetailClient({
  listId, name, description,
}: { listId: string; name: string; description: string | null }) {
  const { t } = useT();
  // Bumped after an import so the table refetches.
  const [reloadKey, setReloadKey] = useState(0);
  const [importing, setImporting] = useState(false);

  return (
    <div className="grid gap-5">
      <div>
        <Link className="hint hover:underline" href="/lists">{t("lists.back")}</Link>
        <h1 className="mt-1 text-xl font-semibold">{name}</h1>
        {description ? <p className="hint mt-1">{description}</p> : null}
      </div>

      <div>
        <button className="btn btn-primary" onClick={() => setImporting((v) => !v)}>
          {importing ? t("lists.hideImport") : t("lists.import")}
        </button>
      </div>

      {importing ? (
        <section className="card p-4">
          <ImportPanel listId={listId} onImported={() => setReloadKey((k) => k + 1)} />
        </section>
      ) : null}

      <ContactsTable listId={listId} reloadKey={reloadKey} />
    </div>
  );
}
