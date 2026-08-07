// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  fetchAttributesMock,
  markBootstrapPendingMock,
  markBootstrapReadyMock,
  resetAttributesMock,
  trackDemoPageViewMock,
  waitForSnowplowTrackerMock,
} = vi.hoisted(() => ({
  fetchAttributesMock: vi.fn(),
  markBootstrapPendingMock: vi.fn(),
  markBootstrapReadyMock: vi.fn(),
  resetAttributesMock: vi.fn(),
  trackDemoPageViewMock: vi.fn(),
  waitForSnowplowTrackerMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

vi.mock("@/components/Analytics/SnowplowProvider", () => ({
  waitForSnowplowTracker: waitForSnowplowTrackerMock,
}));

vi.mock("@/components/Signals/SignalsProvider", () => ({
  useSignals: () => ({
    fetchAttributes: fetchAttributesMock,
    markBootstrapPending: markBootstrapPendingMock,
    markBootstrapReady: markBootstrapReadyMock,
    resetAttributes: resetAttributesMock,
  }),
}));

vi.mock("@/utils/getSessionId", () => ({
  getSessionId: () => "session-123",
}));

vi.mock("@/utils/tracking", () => ({
  trackDemoPageView: trackDemoPageViewMock,
}));

vi.mock("@/utils/useSessionMonitor", () => ({
  useSessionMonitor: () => {},
}));

import { SignalsBootstrap } from "@/components/Signals/SignalsBootstrap";

describe("SignalsBootstrap", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    waitForSnowplowTrackerMock.mockResolvedValue(undefined);
    fetchAttributesMock.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }

    container.remove();
    root = null;
  });

  it("fires page view, fetches attributes, then marks bootstrap ready", async () => {
    root = createRoot(container);

    await act(async () => {
      root?.render(<SignalsBootstrap />);
    });

    expect(markBootstrapPendingMock).toHaveBeenCalledTimes(1);
    expect(trackDemoPageViewMock).toHaveBeenCalledWith("/");
    expect(fetchAttributesMock).toHaveBeenCalledWith("session-123");
    expect(markBootstrapReadyMock).toHaveBeenCalledWith("/");

    expect(trackDemoPageViewMock.mock.invocationCallOrder[0]).toBeLessThan(
      fetchAttributesMock.mock.invocationCallOrder[0]
    );
    expect(fetchAttributesMock.mock.invocationCallOrder[0]).toBeLessThan(
      markBootstrapReadyMock.mock.invocationCallOrder[0]
    );
  });

  it("does not complete a stale bootstrap cycle after unmount", async () => {
    root = createRoot(container);

    let resolveTracker: (() => void) | null = null;
    const trackerDeferred = new Promise<void>((resolve) => {
      resolveTracker = resolve;
    });
    waitForSnowplowTrackerMock.mockReturnValue(trackerDeferred);

    await act(async () => {
      root?.render(<SignalsBootstrap />);
    });

    await act(async () => {
      root?.unmount();
    });
    root = null;

    resolveTracker?.();
    await act(async () => {
      await trackerDeferred;
    });

    expect(trackDemoPageViewMock).not.toHaveBeenCalled();
    expect(fetchAttributesMock).not.toHaveBeenCalled();
    expect(markBootstrapReadyMock).not.toHaveBeenCalled();
  });
});
