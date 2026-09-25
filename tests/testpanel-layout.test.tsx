import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Whether the admin layout sends the test panel to the page. The layout decides on the server, from
 * the environment: the page is never asked. It shows the panel only in a development or test
 * environment with the flag on, and never in production.
 */
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSessionUser: async () => ({ id: "u1", email: "admin@example.test" }) };
});
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirected"); } }));

afterEach(() => vi.unstubAllEnvs());

/** Every element type name in a tree of React elements. */
function names(node: ReactNode, found: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((child) => names(child, found));
  else if (isValidElement(node)) {
    const element = node as ReactElement<{ children?: ReactNode }>;
    found.push(typeof element.type === "string" ? element.type : (element.type as { name?: string }).name ?? "?");
    names(element.props.children, found);
  }
  return found;
}

async function layout() {
  const { default: AdminLayout } = await import("@/app/(admin)/layout");
  return names(await AdminLayout({ children: null }));
}

describe("the admin layout", () => {
  it("has no test panel by default", async () => {
    expect(await layout()).not.toContain("TestPanel");
  });

  it("has the test panel in a test environment with the flag on", async () => {
    vi.stubEnv("ENABLE_EMAIL_TEST_PANEL", "true");
    expect(await layout()).toContain("TestPanel");
  });

  it("has the test panel in a development environment with the flag on", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ENABLE_EMAIL_TEST_PANEL", "true");
    expect(await layout()).toContain("TestPanel");
  });

  it("has none when the flag is off or is not exactly true, whatever the environment", async () => {
    for (const flag of ["false", "1", "True", "yes", ""]) {
      vi.stubEnv("ENABLE_EMAIL_TEST_PANEL", flag);
      expect(await layout(), flag).not.toContain("TestPanel");
    }
  });

  it("has none in production, even with the flag on", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENABLE_EMAIL_TEST_PANEL", "true");
    expect(await layout()).not.toContain("TestPanel");
  });

  it("has none when the environment is not one it knows", async () => {
    vi.stubEnv("NODE_ENV", "staging");
    vi.stubEnv("ENABLE_EMAIL_TEST_PANEL", "true");
    expect(await layout()).not.toContain("TestPanel");
  });

  it("keeps the rest of the page: the navigation and the content", async () => {
    vi.stubEnv("ENABLE_EMAIL_TEST_PANEL", "true");
    const tree = await layout();
    expect(tree).toContain("Nav");
    expect(tree).toContain("main");
  });

  it("does not depend on any public (NEXT_PUBLIC_*) variable: the page is never the judge", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_EMAIL_TEST_PANEL", "true");
    expect(await layout()).not.toContain("TestPanel");
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src/app/(admin)/layout.tsx", "utf8")).not.toContain("NEXT_PUBLIC");
    expect(readFileSync("src/lib/testing/access.ts", "utf8")).not.toMatch(/NEXT_PUBLIC_[A-Z_]+\s*[\]=)]/);
  });
});
