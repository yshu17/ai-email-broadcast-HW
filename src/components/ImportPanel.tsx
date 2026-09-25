"use client";

import { useState } from "react";
import { Alert, api } from "@/components/ui";
import { useT } from "@/i18n/client";
import { Rich } from "@/i18n/rich";
import type { MessageKey } from "@/i18n/translate";
import type { ColumnRole } from "@/lib/csv";

type Summary = {
  received: number;
  imported: number;
  duplicates: number;
  invalid: number;
  skippedSuppressed: number;
  invalidSamples: string[];
};

type PreviewResponse = {
  delimiter: string;
  hasHeader: boolean;
  header: string[];
  mapping: ColumnRole[];
  preview: string[][];
  totalRows: number;
  content: string;
};

const ROLES: ColumnRole[] = ["email", "firstName", "lastName", "ignore"];

/** Paste box + CSV/TXT upload wizard for one list. */
export default function ImportPanel({ listId, onImported }: { listId: string; onImported: () => void }) {
  const { t } = useT();
  const [tab, setTab] = useState<"paste" | "file">("paste");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="grid gap-4">
      <div className="flex gap-1">
        <button className={`btn px-3 py-1.5 text-xs ${tab === "paste" ? "btn-active" : ""}`}
          onClick={() => { setTab("paste"); setSummary(null); setError(null); }}>
          {t("import.tab.paste")}
        </button>
        <button className={`btn px-3 py-1.5 text-xs ${tab === "file" ? "btn-active" : ""}`}
          onClick={() => { setTab("file"); setSummary(null); setError(null); }}>
          {t("import.tab.file")}
        </button>
      </div>

      {error ? <Alert kind="error">{error}</Alert> : null}
      {summary ? <ImportSummaryView summary={summary} /> : null}

      {tab === "paste" ? (
        <PasteImport listId={listId} onDone={(s) => { setSummary(s); setError(null); onImported(); }} onError={setError} />
      ) : (
        <FileImport listId={listId} onDone={(s) => { setSummary(s); setError(null); onImported(); }} onError={setError} />
      )}
    </div>
  );
}

function ImportSummaryView({ summary }: { summary: Summary }) {
  const { t, formatNumber } = useT();
  return (
    <Alert kind={summary.imported > 0 ? "success" : "info"}>
      <div className="grid gap-1">
        <p>
          <Rich text={t("import.summary", {
            imported: formatNumber(summary.imported),
            duplicates: formatNumber(summary.duplicates),
            invalid: formatNumber(summary.invalid),
            skipped: formatNumber(summary.skippedSuppressed),
          })} />
        </p>
        {summary.invalidSamples.length > 0 ? (
          <p className="text-xs opacity-80">
            {t("import.rejected", { samples: summary.invalidSamples.slice(0, 5).join(", ") })}
          </p>
        ) : null}
      </div>
    </Alert>
  );
}

/* ------------------------------------------------------------------ paste */

function PasteImport({
  listId, onDone, onError,
}: { listId: string; onDone: (s: Summary) => void; onError: (e: string) => void }) {
  const { t } = useT();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const result = await api<{ summary: Summary }>("/api/import/paste", {
        method: "POST",
        body: JSON.stringify({ text, listId }),
      });
      onDone(result.summary);
      setText("");
    } catch (err) {
      onError(err instanceof Error ? err.message : t("import.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-2">
      <label className="label" htmlFor="pasteBox">{t("import.paste.label")}</label>
      <textarea
        id="pasteBox"
        className="input font-mono text-xs"
        rows={8}
        placeholder={"john@example.com\nanna@example.com, test@example.com; third@example.com"}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <p className="hint">{t("import.paste.hint", { example: "`Name <addr@example.com>`" })}</p>
      <div>
        <button className="btn btn-primary" disabled={busy || text.trim().length === 0} onClick={submit}>
          {busy ? t("import.importing") : t("import.paste.button")}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- file */

function FileImport({
  listId, onDone, onError,
}: { listId: string; onDone: (s: Summary) => void; onError: (e: string) => void }) {
  const { t } = useT();
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [mapping, setMapping] = useState<ColumnRole[]>([]);
  const [hasHeader, setHasHeader] = useState(true);
  const [isPlain, setIsPlain] = useState(false);
  const [busy, setBusy] = useState(false);

  const upload = async (file: File) => {
    setBusy(true);
    setPreview(null);
    try {
      const plain = file.name.toLowerCase().endsWith(".txt");
      const body = new FormData();
      body.append("file", file);
      const result = await api<PreviewResponse>("/api/import/preview", { method: "POST", body });
      setIsPlain(plain && result.header.length < 2);
      setPreview(result);
      setMapping(result.mapping);
      setHasHeader(result.hasHeader);
    } catch (err) {
      onError(err instanceof Error ? err.message : t("import.file.readFailed"));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const result = await api<{ summary: Summary }>("/api/import/file", {
        method: "POST",
        body: JSON.stringify({
          content: preview.content,
          delimiter: preview.delimiter,
          hasHeader,
          mapping,
          listId,
          plain: isPlain,
        }),
      });
      onDone(result.summary);
      setPreview(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : t("import.failed"));
    } finally {
      setBusy(false);
    }
  };

  const setRole = (index: number, role: ColumnRole) =>
    setMapping((prev) => {
      const next = [...prev];
      // Email maps to exactly one column, so selecting a new one clears the old.
      if (role === "email") {
        for (let i = 0; i < next.length; i++) if (next[i] === "email") next[i] = "ignore";
      }
      next[index] = role;
      return next;
    });

  const emailMapped = isPlain || mapping.includes("email");
  const delimiterKey: MessageKey =
    preview?.delimiter === "\t" ? "import.file.delimiter.tab"
      : preview?.delimiter === ";" ? "import.file.delimiter.semicolon"
        : "import.file.delimiter.comma";

  return (
    <div className="grid gap-3">
      <div>
        <label className="label" htmlFor="fileInput">{t("import.file.step1")}</label>
        <input id="fileInput" className="input" type="file" accept=".csv,.txt,text/csv,text/plain"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }} />
        <p className="hint mt-1">{t("import.file.hint")}</p>
      </div>

      {busy && !preview ? <p className="hint">{t("import.file.reading")}</p> : null}

      {preview ? (
        <>
          <div className="card p-3 text-sm">
            <p className="font-medium">{t("import.file.step2")}</p>
            <p className="hint mt-1">
              <Rich text={t("import.file.detected", {
                delimiter: t(delimiterKey),
                rows: t("import.file.dataRows", { count: preview.totalRows }),
              })} />
              {isPlain ? t("import.file.plainNote") : ""}
            </p>
            {!isPlain ? (
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
                {t("import.file.firstRowHeader")}
              </label>
            ) : null}
          </div>

          {!isPlain ? (
            <div className="card overflow-x-auto p-3">
              <p className="mb-2 text-sm font-medium">{t("import.file.step34")}</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-left">
                    {preview.header.map((label, index) => (
                      <th key={index} className="px-2 py-2 align-top">
                        <div className="font-medium">{label}</div>
                        <select
                          className="input mt-1 px-1 py-0.5 text-xs"
                          value={mapping[index] ?? "ignore"}
                          onChange={(e) => setRole(index, e.target.value as ColumnRole)}
                          aria-label={t("import.file.mapColumn", { label })}
                        >
                          {ROLES.map((role) => (
                            <option key={role} value={role}>{t(`import.role.${role}` as MessageKey)}</option>
                          ))}
                        </select>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.preview.map((row, rowIndex) => (
                    <tr key={rowIndex} className="border-b last:border-0">
                      {preview.header.map((_h, cellIndex) => (
                        <td key={cellIndex} className="px-2 py-1 whitespace-nowrap"
                          style={{ color: "var(--color-muted)" }}>
                          {row[cellIndex] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!emailMapped ? (
                <p className="mt-2 text-xs text-red-600 dark:text-red-400">{t("import.file.emailRequired")}</p>
              ) : null}
            </div>
          ) : null}

          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={busy || !emailMapped} onClick={confirm}>
              {busy ? t("import.importing") : t("import.file.importRows", { count: preview.totalRows })}
            </button>
            <button className="btn" onClick={() => setPreview(null)} disabled={busy}>{t("common.cancel")}</button>
          </div>
        </>
      ) : null}
    </div>
  );
}
