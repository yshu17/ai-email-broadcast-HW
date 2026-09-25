import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/components/ui";

/**
 * A 401 means "your session is gone", so the browser client sends the person to the
 * sign-in page. On the sign-in page itself a 401 is just "wrong password": going to
 * the sign-in page again would reload it and throw the error message away before
 * anyone could read it.
 */
afterEach(() => vi.unstubAllGlobals());

function stubBrowser(pathname: string) {
  const assign = vi.fn();
  vi.stubGlobal("window", { location: { pathname, origin: "https://mail.example.test", assign } });
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify({ error: "Invalid email or password" }), {
      status: 401, headers: { "content-type": "application/json" },
    })));
  return assign;
}

describe("api() and a 401", () => {
  it("sends the person to the sign-in page when their session has gone", async () => {
    const assign = stubBrowser("/campaigns");

    await expect(api("/api/campaigns")).rejects.toMatchObject({ status: 401 });

    expect(assign).toHaveBeenCalledWith("https://mail.example.test/login");
  });

  it("does not reload the sign-in page over a wrong password, so the message can be read", async () => {
    const assign = stubBrowser("/login");

    await expect(api("/api/auth/login", { method: "POST" })).rejects.toMatchObject({
      status: 401, message: "Invalid email or password",
    });

    expect(assign).not.toHaveBeenCalled();
  });
});
