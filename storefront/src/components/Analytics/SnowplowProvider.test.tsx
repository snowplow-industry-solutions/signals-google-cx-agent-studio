// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  newSessionMock,
  newTrackerMock,
  addGlobalContextsMock,
  addInterventionHandlersMock,
  createUserContextMock,
  removeGlobalContextsMock,
  subscribeToInterventionsMock,
  fetchAttributesMock,
  markBootstrapPendingMock,
  markBootstrapReadyMock,
  resetAttributesMock,
  trackDemoPageViewMock,
  signalsState,
} = vi.hoisted(() => ({
  newSessionMock: vi.fn(),
  newTrackerMock: vi.fn(),
  addGlobalContextsMock: vi.fn(),
  addInterventionHandlersMock: vi.fn(),
  createUserContextMock: vi.fn(),
  removeGlobalContextsMock: vi.fn(),
  subscribeToInterventionsMock: vi.fn(),
  fetchAttributesMock: vi.fn(),
  markBootstrapPendingMock: vi.fn(),
  markBootstrapReadyMock: vi.fn(),
  resetAttributesMock: vi.fn(),
  trackDemoPageViewMock: vi.fn(),
  signalsState: {
    attributes: null as
      | null
      | {
          favorite_category?: string;
          price_affinity?: string;
          cart_value_band?: string;
        },
  },
}));

vi.mock("@snowplow/browser-tracker", () => ({
  addGlobalContexts: addGlobalContextsMock,
  newSession: newSessionMock,
  newTracker: newTrackerMock,
  removeGlobalContexts: removeGlobalContextsMock,
}));

vi.mock("@snowplow/signals-browser-plugin", () => ({
  SignalsPlugin: () => ({ plugin: "signals" }),
  addInterventionHandlers: addInterventionHandlersMock,
  subscribeToInterventions: subscribeToInterventionsMock,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

vi.mock("@/components/Signals/SignalsProvider", () => ({
  useSignals: () => ({
    attributes: signalsState.attributes,
    fetchAttributes: fetchAttributesMock,
    markBootstrapPending: markBootstrapPendingMock,
    markBootstrapReady: markBootstrapReadyMock,
    resetAttributes: resetAttributesMock,
  }),
}));

vi.mock("@/utils/userTracking", () => ({
  createUserContext: createUserContextMock,
}));

vi.mock("@/utils/getSessionId", () => ({
  getSessionId: () => null,
}));

vi.mock("@/utils/tracking", () => ({
  trackDemoPageView: trackDemoPageViewMock,
}));

vi.mock("@/utils/useSessionMonitor", () => ({
  useSessionMonitor: () => {},
}));

import { SignalsBootstrap } from "@/components/Signals/SignalsBootstrap";

import {
  resetSnowplowTrackerReadyForTests,
  SnowplowProvider,
  waitForSnowplowTracker,
} from "./SnowplowProvider";

describe("SnowplowProvider", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    vi.stubEnv(
      "NEXT_PUBLIC_SNOWPLOW_COLLECTOR_URL",
      "https://collector.example.test"
    );
    vi.stubEnv("NEXT_PUBLIC_SNOWPLOW_APP_ID", "atelier-storefront-dev");
    container = document.createElement("div");
    document.body.appendChild(container);
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    signalsState.attributes = null;
    resetSnowplowTrackerReadyForTests();
    createUserContextMock.mockReturnValue({
      schema: "iglu:com.snowplow_demo.fashion/user/jsonschema/1-0-0",
      data: {
        shopper_profile_id: "shopper-123",
      },
    });
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }
    container.remove();
    root = null;
    vi.unstubAllEnvs();
  });

  it("initializes the tracker before firing the initial page view", async () => {
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <SnowplowProvider>
          <SignalsBootstrap />
        </SnowplowProvider>
      );
    });

    expect(newTrackerMock).toHaveBeenCalledTimes(1);
    expect(newTrackerMock).toHaveBeenCalledWith(
      "fashion_demo",
      "https://collector.example.test",
      expect.objectContaining({ appId: "atelier-storefront-dev" })
    );
    expect(trackDemoPageViewMock).toHaveBeenCalledTimes(1);
    expect(trackDemoPageViewMock).toHaveBeenCalledWith("/");
    expect(newTrackerMock.mock.invocationCallOrder[0]).toBeLessThan(
      trackDemoPageViewMock.mock.invocationCallOrder[0]
    );
  });

  it("passes the custom tracker request path to the browser tracker when set", async () => {
    vi.stubEnv("NEXT_PUBLIC_SNOWPLOW_POST_PATH", "/custom/tracker/path");
    root = createRoot(container);

    await act(async () => {
      root?.render(<SnowplowProvider>ready</SnowplowProvider>);
    });

    expect(newTrackerMock).toHaveBeenCalledWith(
      "fashion_demo",
      "https://collector.example.test",
      expect.objectContaining({ postPath: "/custom/tracker/path" })
    );
  });

  it("omits the tracker request path when unset, so the tracker uses its own default", async () => {
    root = createRoot(container);

    await act(async () => {
      root?.render(<SnowplowProvider>ready</SnowplowProvider>);
    });

    expect(newTrackerMock).toHaveBeenCalledWith(
      "fashion_demo",
      "https://collector.example.test",
      expect.objectContaining({ postPath: undefined })
    );
  });

  it("disables tracking when the app ID env var is not set", async () => {
    vi.stubEnv("NEXT_PUBLIC_SNOWPLOW_APP_ID", "");
    root = createRoot(container);

    await act(async () => {
      root?.render(<SnowplowProvider>ready</SnowplowProvider>);
    });

    expect(newTrackerMock).not.toHaveBeenCalled();
  });

  it("resolves tracker readiness after provider initialization", async () => {
    root = createRoot(container);

    let resolved = false;
    const trackerReady = waitForSnowplowTracker().then(() => {
      resolved = true;
    });

    expect(resolved).toBe(false);

    await act(async () => {
      root?.render(<SnowplowProvider>ready</SnowplowProvider>);
    });

    await trackerReady;

    expect(resolved).toBe(true);
    expect(newTrackerMock).toHaveBeenCalledTimes(1);
  });

  it("registers and refreshes the global user context when Signals attributes change", async () => {
    root = createRoot(container);

    await act(async () => {
      root?.render(<SnowplowProvider>ready</SnowplowProvider>);
    });

    expect(createUserContextMock).toHaveBeenCalledWith(null);
    expect(addGlobalContextsMock).toHaveBeenCalledWith(
      {
        user: {
          schema: "iglu:com.snowplow_demo.fashion/user/jsonschema/1-0-0",
          data: {
            shopper_profile_id: "shopper-123",
          },
        },
      },
      ["fashion_demo"]
    );

    signalsState.attributes = {
      favorite_category: "Accessories",
      price_affinity: "premium",
      cart_value_band: "considered",
    };
    createUserContextMock.mockReturnValue({
      schema: "iglu:com.snowplow_demo.fashion/user/jsonschema/1-0-0",
      data: {
        shopper_profile_id: "shopper-123",
        favorite_category: "Accessories",
        price_affinity: "premium",
        cart_value_band: "considered",
      },
    });

    await act(async () => {
      root?.render(<SnowplowProvider>ready</SnowplowProvider>);
    });

    expect(removeGlobalContextsMock).toHaveBeenCalledWith(["user"], ["fashion_demo"]);
    expect(addGlobalContextsMock).toHaveBeenLastCalledWith(
      {
        user: {
          schema: "iglu:com.snowplow_demo.fashion/user/jsonschema/1-0-0",
          data: {
            shopper_profile_id: "shopper-123",
            favorite_category: "Accessories",
            price_affinity: "premium",
            cart_value_band: "considered",
          },
        },
      },
      ["fashion_demo"]
    );
  });
});
