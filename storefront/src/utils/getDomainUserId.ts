import { allTrackerNames, getTracker } from "@snowplow/browser-tracker-core";

// @snowplow/browser-tracker re-exports getDomainSessionId() as a convenience
// wrapper around the tracker instance, but not the equivalent domain user id
// getter, even though BrowserTracker itself has one. This mirrors that
// wrapper's own dispatch-to-first-registered-tracker logic against the same
// tracker registry (browser-tracker-core), which browser-tracker is built on.
export function getDomainUserId(trackerId?: string): string | undefined {
  const resolvedTrackerId = trackerId ?? allTrackerNames()[0];
  if (!resolvedTrackerId) {
    return undefined;
  }

  return getTracker(resolvedTrackerId)?.getDomainUserId();
}
