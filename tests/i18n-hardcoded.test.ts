import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

/**
 * "The whole interface is translated" is a claim about every screen, so it is
 * checked over the source rather than trusted. Every `.tsx` file under `src/app` and
 * `src/components` is parsed, and anything a person could read that is a literal
 * English word — JSX text, the text-bearing attributes, `confirm()`/`alert()` texts,
 * and messages handed to the error/notice setters — fails the test with the file and
 * line. The fix is always the same: move the text into the dictionary and use `t()`.
 */
const ROOTS = ["src/app", "src/components"];

/** Names, protocols and units that are the same in every language. */
const ALLOWED = new Set([
  "HTML", "SMTP", "CSV", "TXT", "URL", "API", "JSON", "UTF", "UTC", "Mailer", "RU", "EN", "STARTTLS", "TLS", "SSL",
  "SendPulse", "AES", "GCM", "Ctrl", "Shift", "MB", "AM", "PM",
]);

/** Attributes whose value a person reads or hears (screen readers). */
const TEXT_ATTRIBUTES = new Set(["title", "placeholder", "aria-label", "alt", "label", "aria-description"]);

/** Functions whose string arguments end up on screen. */
const TEXT_CALLS = /^(confirm|alert|prompt|setError|setNotice|onError|onNotice)$/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

/** English-looking words in a piece of text, ignoring things that are not prose. */
function englishWords(text: string): string[] {
  const prose = text
    .replace(/[\w.+-]+@[\w.-]+\.\w+/g, " ") // email addresses
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[\w-]+\.(com|test|org|net|io)\b/g, " ") // host names
    .replace(/\{\{[^}]*\}\}/g, " ") // {{firstName}} and friends
    .replace(/`[^`]*`/g, " "); // quoted examples
  return (prose.match(/[A-Za-z][A-Za-z'’]{2,}/g) ?? []).filter((word) => !ALLOWED.has(word));
}

type Finding = { where: string; text: string };

function scanSource(name: string, code: string): Finding[] {
  const source = ts.createSourceFile(name, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: Finding[] = [];
  const report = (node: ts.Node, text: string) => {
    if (englishWords(text).length === 0) return;
    const { line } = source.getLineAndCharacterOfPosition(node.getStart());
    found.push({ where: `${name}:${line + 1}`, text: text.trim().replace(/\s+/g, " ").slice(0, 80) });
  };

  /** Every literal text inside an expression that will be rendered (conditionals, `&&`, templates). */
  const literalsIn = (node: ts.Node): ts.Node[] => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node];
    if (ts.isTemplateExpression(node)) return [node.head, ...node.templateSpans.map((span) => span.literal)];
    if (ts.isParenthesizedExpression(node)) return literalsIn(node.expression);
    if (ts.isConditionalExpression(node)) return [...literalsIn(node.whenTrue), ...literalsIn(node.whenFalse)];
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
        return [...literalsIn(node.left), ...literalsIn(node.right)];
      }
    }
    return [];
  };
  const textOf = (node: ts.Node) =>
    ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)
      ? node.text
      : "";

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) report(node, node.text);

    if (ts.isJsxAttribute(node) && TEXT_ATTRIBUTES.has(node.name.getText())) {
      const value = node.initializer;
      if (value && ts.isStringLiteral(value)) report(value, value.text);
      if (value && ts.isJsxExpression(value) && value.expression) {
        for (const literal of literalsIn(value.expression)) report(literal, textOf(literal));
      }
    }

    // {"text"}, {cond ? "a" : "b"}, {`text ${x}`} as a child: text on the page.
    if (ts.isJsxExpression(node) && node.expression && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      for (const literal of literalsIn(node.expression)) report(literal, textOf(literal));
    }

    if (ts.isCallExpression(node)) {
      const callee = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : node.expression.getText();
      if (TEXT_CALLS.test(callee)) {
        for (const argument of node.arguments) for (const literal of literalsIn(argument)) report(literal, textOf(literal));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("the interface has no hard-coded English", () => {
  const sources = ROOTS.flatMap(files);

  it("scans a meaningful number of files", () => {
    expect(sources.length).toBeGreaterThan(20);
  });

  it("finds English words in JSX text, text attributes, dialogs and notices — and none are left", () => {
    const findings = sources.flatMap((path) =>
      scanSource(relative(process.cwd(), path).replace(/\\/g, "/"), readFileSync(path, "utf8")));
    expect(findings.map((f) => `${f.where}  ${JSON.stringify(f.text)}`)).toEqual([]);
  });
});

describe("the scanner itself (so a green result means something)", () => {
  const flagged = (code: string) => scanSource("snippet.tsx", code).map((f) => f.text);

  it("flags English JSX text", () => {
    expect(flagged("const a = <p>Save your changes</p>;")).toEqual(["Save your changes"]);
    expect(flagged("const a = <p>Сохраните изменения</p>;")).toEqual([]);
  });

  it("flags English in text attributes, however they are written", () => {
    expect(flagged('const a = <input placeholder="Search by email" />;')).toEqual(["Search by email"]);
    expect(flagged('const a = <button aria-label="Close dialog" />;')).toEqual(["Close dialog"]);
    expect(flagged('const a = <button title={cond ? "Bold text" : "Italic text"} />;')).toEqual(["Bold text", "Italic text"]);
    expect(flagged("const a = <img alt={`Chart of ${n}`} />;").join()).toContain("Chart of");
  });

  it("flags English rendered from an expression", () => {
    expect(flagged('const a = <p>{busy ? "Saving…" : "Save draft"}</p>;')).toEqual(["Saving…", "Save draft"]);
    expect(flagged('const a = <p>{ok && "It worked"}</p>;')).toEqual(["It worked"]);
    expect(flagged("const a = <p>{`Hello ${name}`}</p>;").join()).toContain("Hello");
  });

  it("flags English handed to dialogs and to the error and notice setters", () => {
    expect(flagged('confirm("Delete this contact?");')).toEqual(["Delete this contact?"]);
    expect(flagged('window.alert("Links must start with https");').join()).toContain("Links must start");
    expect(flagged('setError(err instanceof Error ? err.message : "Save failed");')).toEqual(["Save failed"]);
    expect(flagged('onNotice("Saved.");')).toEqual(["Saved."]);
  });

  it("lets translated text, identifiers and non-text through", () => {
    expect(flagged('const a = <p title={t("x.title")}>{t("x.body")}</p>;')).toEqual([]);
    expect(flagged('const a = <div className="btn btn-primary" id="save" type="submit" />;')).toEqual([]);
    expect(flagged('setStatus("QUEUED"); const s = "SCHEDULED";')).toEqual([]);
    expect(flagged('const a = <p>{`${count}`}</p>;')).toEqual([]);
    expect(flagged('const a = <button title={t("k")}>HTML</button>;')).toEqual([]);
  });

  it("does not mistake addresses, hosts, variables and protocol names for prose", () => {
    expect(englishWords("you@example.com, smtp-pulse.com, {{firstName}}, SendPulse (STARTTLS), TLS/SSL, AES-256-GCM, Ctrl+B"))
      .toEqual([]);
    expect(englishWords("B I U H1 P")).toEqual([]);
    expect(englishWords("Сохранить изменения")).toEqual([]);
    expect(englishWords("Save and continue")).toEqual(["Save", "and", "continue"]);
  });
});
