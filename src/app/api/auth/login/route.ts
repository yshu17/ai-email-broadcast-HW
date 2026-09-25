import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { HttpError, assertSameOrigin, authenticate, createSession } from "@/lib/auth";
import { handle, readJson, str } from "@/lib/api";
import { callerAddress, loginAllowed, recordLoginFailure, recordLoginSuccess } from "@/lib/login-throttle";

export async function POST(request: Request) {
  return handle(async () => {
    await assertSameOrigin();
    const body = await readJson<{ email?: string; password?: string }>(request);
    const email = str(body.email, "Email", { max: 254 });
    const password = str(body.password, "Password", { max: 512 });

    // Before any password is checked, so a guessing script gets refused without costing a hash each time.
    const address = callerAddress(await headers());
    if (!loginAllowed(email, address)) throw new HttpError(429, "err.auth.tooManyAttempts");

    const user = await authenticate(email, password);
    if (!user) {
      recordLoginFailure(email, address);
      // Deliberately vague: no account enumeration.
      throw new HttpError(401, "err.auth.invalidCredentials");
    }
    recordLoginSuccess(email);
    await createSession(user.id);
    return NextResponse.json({ ok: true });
  });
}
