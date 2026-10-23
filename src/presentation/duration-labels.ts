import { padTwoDigits } from "../utils/number-format";

// Household-facing media lengths: "1:04" for 64 seconds. Long videos keep
// counting minutes ("75:03") rather than adding an hours field.
export function formatDurationLabel(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${padTwoDigits(seconds)}`;
}
