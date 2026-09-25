import { api } from "@/components/ui";
import type { ClockSnapshot } from "@/lib/clock";
import type { CycleReport } from "@/lib/scheduler";
import type { TestPanelSnapshot } from "@/lib/testing/snapshot";
import type { HistoryItem, QueueRow } from "@/lib/testing/test-campaigns";
import type { TestSchedulerSnapshot } from "@/lib/testing/test-scheduler";

/**
 * The panel's calls to its own test-only API, typed. Every one goes through the app's usual
 * `api()` wrapper, so errors arrive as the server's own words (in the language on screen) and a
 * lost session sends the person to the sign-in page like anywhere else.
 */
const post = <T,>(url: string, body: unknown) => api<T>(url, { method: "POST", body: JSON.stringify(body) });

export type SchedulerAnswer =
  | { snapshot: TestSchedulerSnapshot }
  | { ran: boolean; reason: "busy" | "stopped" | null; report: CycleReport | null; snapshot: TestSchedulerSnapshot };

export type CampaignDetails = {
  campaign: { id: string; name: string; status: string; scheduledAt: string | null; createdAt: string };
  queue: QueueRow[];
  history: HistoryItem[];
};

export const panelApi = {
  state: (since: number) => api<TestPanelSnapshot>(`/api/dev/state?since=${since}`),
  clock: (body: Record<string, unknown>) => post<{ clock: ClockSnapshot }>("/api/dev/clock", body),
  scheduler: (body: Record<string, unknown>) => post<SchedulerAnswer>("/api/dev/scheduler", body),
  rateLimit: (body: Record<string, unknown>) =>
    post<{ override: { maxEmails: number; windowSeconds: number } | null }>("/api/dev/rate-limit", body),
  createCampaign: (body: Record<string, unknown>) =>
    post<{ campaign: { id: string; name: string; status: string; scheduledAt: string | null }; recipients: number; scenario: string }>(
      "/api/dev/campaigns", body),
  campaign: (id: string) => api<CampaignDetails>(`/api/dev/campaigns/${id}`),
  resetCampaign: (id: string) => api<{ ok: true; removedContacts: number }>(`/api/dev/campaigns/${id}`, { method: "DELETE" }),
};
