"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import type { MessageKey } from "@/i18n/translate";

/**
 * Small contenteditable WYSIWYG editor.
 *
 * Deliberately not a library: the required feature set (headings, bold, italic,
 * underline, links, lists, alignment, undo/redo) maps one-to-one onto
 * document.execCommand, which every current browser still implements. That is
 * ~100 lines instead of a multi-megabyte editor framework, and the output is
 * plain HTML that email clients understand.
 *
 * Everything produced here is sanitized server-side before it is stored.
 */

type Props = {
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
};

type ToolbarButton = {
  /** What the button shows: a glyph, or (when `labelKey` is set) a word from the dictionary. */
  label: string;
  labelKey?: MessageKey;
  titleKey: MessageKey;
  command: string;
  argument?: string;
  isBlock?: boolean;
};

const INLINE: ToolbarButton[] = [
  { label: "B", titleKey: "editor.bold", command: "bold" },
  { label: "I", titleKey: "editor.italic", command: "italic" },
  { label: "U", titleKey: "editor.underline", command: "underline" },
];

const BLOCKS: ToolbarButton[] = [
  { label: "P", titleKey: "editor.paragraph", command: "formatBlock", argument: "p", isBlock: true },
  { label: "H1", titleKey: "editor.heading1", command: "formatBlock", argument: "h1", isBlock: true },
  { label: "H2", titleKey: "editor.heading2", command: "formatBlock", argument: "h2", isBlock: true },
  { label: "H3", titleKey: "editor.heading3", command: "formatBlock", argument: "h3", isBlock: true },
];

const LISTS: ToolbarButton[] = [
  { label: "", labelKey: "editor.bulletedLabel", titleKey: "editor.bulletedList", command: "insertUnorderedList" },
  { label: "", labelKey: "editor.numberedLabel", titleKey: "editor.numberedList", command: "insertOrderedList" },
];

const ALIGN: ToolbarButton[] = [
  { label: "⯇", titleKey: "editor.alignLeft", command: "justifyLeft" },
  { label: "≡", titleKey: "editor.alignCenter", command: "justifyCenter" },
  { label: "⯈", titleKey: "editor.alignRight", command: "justifyRight" },
];

export default function Editor({ value, onChange, disabled }: Props) {
  const { t } = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [showSource, setShowSource] = useState(false);
  const [source, setSource] = useState(value);

  // Only write into the DOM when the incoming value genuinely differs, or the
  // browser would reset the caret to the start on every keystroke.
  useEffect(() => {
    if (showSource) return;
    const node = ref.current;
    if (node && node.innerHTML !== value) node.innerHTML = value;
  }, [value, showSource]);

  const exec = useCallback(
    (button: ToolbarButton) => {
      if (disabled) return;
      ref.current?.focus();
      document.execCommand(button.command, false, button.argument);
      onChange(ref.current?.innerHTML ?? "");
    },
    [disabled, onChange],
  );

  const addLink = useCallback(() => {
    if (disabled) return;
    const url = window.prompt(t("editor.linkPrompt"));
    if (!url) return;
    if (!/^(https?:|mailto:|tel:)/i.test(url)) {
      window.alert(t("editor.linkInvalid"));
      return;
    }
    ref.current?.focus();
    document.execCommand("createLink", false, url);
    onChange(ref.current?.innerHTML ?? "");
  }, [disabled, onChange, t]);

  /** Paste as plain text: pasted markup from Word/web is a formatting minefield. */
  const onPaste = useCallback((event: React.ClipboardEvent) => {
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
  }, []);

  const toolbarButton = (button: ToolbarButton) => (
    <button
      key={button.titleKey}
      type="button"
      className="btn px-2 py-1 text-xs"
      title={t(button.titleKey)}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => exec(button)}
    >
      {button.labelKey ? t(button.labelKey) : button.label}
    </button>
  );

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-1 border-b p-2">
        {BLOCKS.map(toolbarButton)}
        <span className="mx-1 h-4 w-px" style={{ backgroundColor: "var(--color-border)" }} />
        {INLINE.map(toolbarButton)}
        <span className="mx-1 h-4 w-px" style={{ backgroundColor: "var(--color-border)" }} />
        {LISTS.map(toolbarButton)}
        <span className="mx-1 h-4 w-px" style={{ backgroundColor: "var(--color-border)" }} />
        {ALIGN.map(toolbarButton)}
        <span className="mx-1 h-4 w-px" style={{ backgroundColor: "var(--color-border)" }} />
        <button type="button" className="btn px-2 py-1 text-xs" onMouseDown={(e) => e.preventDefault()}
          onClick={addLink} disabled={disabled} title={t("editor.insertLink")}>{t("editor.linkLabel")}</button>
        <button type="button" className="btn px-2 py-1 text-xs" onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec({ label: "", titleKey: "editor.removeLink", command: "unlink" })} disabled={disabled}
          title={t("editor.removeLink")}>{t("editor.unlinkLabel")}</button>
        <span className="mx-1 h-4 w-px" style={{ backgroundColor: "var(--color-border)" }} />
        <button type="button" className="btn px-2 py-1 text-xs" onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec({ label: "", titleKey: "editor.undo", command: "undo" })} disabled={disabled}
          title={t("editor.undo")}>↶</button>
        <button type="button" className="btn px-2 py-1 text-xs" onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec({ label: "", titleKey: "editor.redo", command: "redo" })} disabled={disabled}
          title={t("editor.redo")}>↷</button>

        <button
          type="button"
          className="btn ml-auto px-2 py-1 text-xs"
          onClick={() => {
            if (showSource) {
              onChange(source);
            } else {
              // Entering source view: seed the textarea from the live document.
              setSource(ref.current?.innerHTML ?? value);
            }
            setShowSource((s) => !s);
          }}
        >
          {showSource ? t("editor.visual") : "HTML"}
        </button>
      </div>

      {showSource ? (
        <textarea
          className="w-full resize-y border-0 bg-transparent p-4 font-mono text-xs"
          style={{ minHeight: "20rem", color: "var(--color-ink)" }}
          value={source}
          disabled={disabled}
          spellCheck={false}
          onChange={(e) => setSource(e.target.value)}
          onBlur={() => onChange(source)}
          aria-label={t("editor.sourceLabel")}
        />
      ) : (
        <div
          ref={ref}
          className="editor-surface"
          contentEditable={!disabled}
          suppressContentEditableWarning
          data-placeholder={t("editor.placeholder", { variable: "{{firstName}}" })}
          onInput={(e) => onChange((e.target as HTMLDivElement).innerHTML)}
          onBlur={(e) => onChange((e.target as HTMLDivElement).innerHTML)}
          onPaste={onPaste}
          role="textbox"
          aria-multiline="true"
          aria-label={t("wizard.compose.content")}
        />
      )}
    </div>
  );
}
