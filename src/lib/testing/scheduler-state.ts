import { processState } from "../process-state";
import { TEST_LIMITS } from "./limits";

/**
 * The test scheduler loop's state, apart from the loop itself, so that the scheduler
 * service (which asks "is it stopped?") and the loop (which changes it) can both read it
 * without importing each other.
 */
export type LoopState = {
  running: boolean;
  intervalSeconds: number;
  timer: ReturnType<typeof setTimeout> | null;
  /** Epoch ms of the next pass, while one is waiting. */
  nextCycleAt: number | null;
  /** Epoch ms the last pass ended, to measure the wait from. */
  lastEndedAt: number | null;
};

export const loopState = processState<LoopState>("test.scheduler", () => ({
  running: false,
  intervalSeconds: TEST_LIMITS.schedulerInterval.default,
  timer: null,
  nextCycleAt: null,
  lastEndedAt: null,
}));
