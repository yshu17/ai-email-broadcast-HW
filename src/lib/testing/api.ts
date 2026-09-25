import { NextResponse } from "next/server";
import { badRequest, handle, notFound, withAuth, withAuthMutation, type Handler } from "../api";
import { testPanelEnabled } from "./access";
import { limitBounds, type LimitId } from "./limits";
import type { MessageKey } from "../../i18n/translate";

/**
 * How every test-only endpoint is guarded.
 *
 * 1. Not there at all unless the test tools are on: outside a development or test
 *    environment with the flag set, the answer is the same 404 as for any address the
 *    app does not have, whether or not there is a session, so nothing about it can be
 *    learned. (In a production build these routes are not even compiled in, see
 *    `next.config.ts`; this check is the second lock on the same door.)
 * 2. Then it needs a signed-in admin, like any other admin endpoint, and a mutating call
 *    needs the same-origin check as well.
 *
 * The app has one kind of user (an admin of the whole workspace), so there is no
 * separate "developer" role to require: the flag is what makes someone a tester.
 */
export async function withTestPanel(fn: Handler, options: { mutation?: boolean } = {}): Promise<NextResponse | Response> {
  if (!testPanelEnabled()) return handle(async () => notFound());
  return options.mutation ? withAuthMutation(fn) : withAuth(fn);
}

/** The English label of each numeric field, as `describeError` looks it up in the dictionary. */
const FIELD_LABEL: Record<LimitId, string> = {
  schedulerInterval: "Scheduler interval",
  rateMaxEmails: "Max emails",
  rateWindowSeconds: "Interval",
  recipients: "Recipients",
  slowDelaySeconds: "Slow response delay",
  temporaryFailures: "Temporary failures",
  overdueMinutes: "Overdue by",
};

/** 400 for a number that is missing or out of its range; the text says the range enforced. */
export function rejectInteger(limit: LimitId, code: "TEST_REQUIRED" | "TEST_RANGE"): never {
  const { min, max } = limitBounds(limit);
  if (code === "TEST_REQUIRED") badRequest("err.test.required", { field: FIELD_LABEL[limit] }, { code, field: limit });
  badRequest("err.test.range", { field: FIELD_LABEL[limit], min, max }, { code, field: limit });
}

export function rejectField(key: MessageKey, field: string, params?: Record<string, string | number>): never {
  badRequest(key, params, { code: "TEST_INVALID", field });
}
