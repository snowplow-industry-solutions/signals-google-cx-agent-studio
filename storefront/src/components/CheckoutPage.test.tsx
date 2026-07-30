// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { trackCheckoutStartedSpecMock, clearCartMock } = vi.hoisted(() => ({
  trackCheckoutStartedSpecMock: vi.fn(),
  clearCartMock: vi.fn(),
}));

let trackerReadyPromise = Promise.resolve();
let resolveTrackerReady: () => void = () => {};

vi.mock("@/snowtype/snowplow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/snowtype/snowplow")>();

  return {
    ...actual,
    trackCheckoutStartedSpec: trackCheckoutStartedSpecMock,
  };
});

vi.mock("@/components/Analytics/SnowplowProvider", () => ({
  waitForSnowplowTracker: () => trackerReadyPromise,
}));

vi.mock("@/components/Cart/CartProvider", () => ({
  useCart: () => ({
    lineItems: [{ productId: "p4", quantity: 1 }],
    subtotal: 620,
    clearCart: clearCartMock,
  }),
}));

vi.mock("@/components/Demo/DemoModeProvider", () => ({
  useDemoMode: () => ({
    highlightPersonalization: false,
  }),
}));

vi.mock("@/components/Demo/SignalsDebugPanel", () => ({
  SignalsDebugPanel: () => null,
}));

vi.mock("@/components/Signals/SignalsProvider", () => ({
  useSignals: () => ({
    attributes: null,
  }),
}));

import { CheckoutPage } from "@/components/CheckoutPage";

describe("CheckoutPage", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    trackerReadyPromise = new Promise<void>((resolve) => {
      resolveTrackerReady = resolve;
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
  });

  it("does not track the checkout start until the Snowplow tracker is registered", async () => {
    root = createRoot(container);

    await act(async () => {
      root?.render(<CheckoutPage />);
    });

    expect(trackCheckoutStartedSpecMock).not.toHaveBeenCalled();

    await act(async () => {
      resolveTrackerReady();
      await trackerReadyPromise;
    });

    expect(trackCheckoutStartedSpecMock).toHaveBeenCalledTimes(1);
    expect(trackCheckoutStartedSpecMock.mock.calls[0]?.[0]).toMatchObject({
      checkout_step: "shipping",
    });
  });
});
