import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { testPanelEnabled } from "@/lib/testing/access";
import Nav from "@/components/Nav";

/**
 * The developer test panel, if this environment has one. Two locks, both on the server: a
 * production build removes this branch altogether (`NODE_ENV` is a build-time constant, so the
 * import below is not even bundled), and anywhere else the panel exists only when
 * `testPanelEnabled()` says so (a development or test environment with the flag on). The page is
 * never asked to decide.
 */
async function loadTestPanel() {
  if (process.env.NODE_ENV === "production") return null;
  if (!testPanelEnabled()) return null;
  return (await import("@/components/testpanel/TestPanel")).default;
}

/**
 * Every admin page is behind this layout's session check, so an unauthenticated
 * request never renders admin markup — the API routes enforce it independently.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const TestPanel = await loadTestPanel();

  return (
    <>
      <Nav email={user.email} />
      {TestPanel ? <TestPanel /> : null}
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </>
  );
}
