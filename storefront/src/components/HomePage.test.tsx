// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SignalsAttributes } from "@/types/signals";

const { trackProductListViewedSpecMock } = vi.hoisted(() => ({
  trackProductListViewedSpecMock: vi.fn(),
}));

let attributesState: SignalsAttributes | null = null;
let bootstrapReadyState = false;

vi.mock("@/snowtype/snowplow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/snowtype/snowplow")>();

  return {
    ...actual,
    trackProductListViewedSpec: trackProductListViewedSpecMock,
  };
});

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

vi.mock("@/components/Demo/DemoModeProvider", () => ({
  useDemoMode: () => ({
    highlightPersonalization: false,
  }),
}));

vi.mock("@/components/Demo/SignalsDebugPanel", () => ({
  SignalsDebugPanel: () => null,
}));

vi.mock("@/components/ProductCard", () => ({
  ProductCard: ({ product }: { product: { id: string; name: string } }) => (
    <div data-testid={`product-card-${product.id}`}>{product.name}</div>
  ),
}));

vi.mock("@/components/Signals/SignalsProvider", () => ({
  useSignals: () => ({
    attributes: attributesState,
    bootstrapReady: bootstrapReadyState,
  }),
}));

import { HomePage } from "@/components/HomePage";

describe("HomePage", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    attributesState = null;
    bootstrapReadyState = false;
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

  it("waits for bootstrap readiness before tracking the homepage featured list", async () => {
    root = createRoot(container);

    await act(async () => {
      root?.render(<HomePage />);
    });

    expect(trackProductListViewedSpecMock).not.toHaveBeenCalled();

    bootstrapReadyState = true;
    attributesState = {
      favorite_category: "Accessories",
      favorite_designer: "Arc Studio",
    };

    await act(async () => {
      root?.render(<HomePage />);
    });

    expect(trackProductListViewedSpecMock).toHaveBeenCalledTimes(1);
  });

  it("does not retrack the homepage featured list when unrelated attributes change", async () => {
    root = createRoot(container);
    bootstrapReadyState = true;
    attributesState = {
      favorite_category: "Accessories",
      favorite_designer: "Arc Studio",
    };

    await act(async () => {
      root?.render(<HomePage />);
    });

    expect(trackProductListViewedSpecMock).toHaveBeenCalledTimes(1);

    attributesState = {
      favorite_category: "Accessories",
      favorite_designer: "Arc Studio",
      favorite_occasion: "Evening",
    };

    await act(async () => {
      root?.render(<HomePage />);
    });

    expect(trackProductListViewedSpecMock).toHaveBeenCalledTimes(1);
  });

  it("tracks the homepage featured list again when personalization changes the rendered list", async () => {
    root = createRoot(container);
    bootstrapReadyState = true;

    await act(async () => {
      root?.render(<HomePage />);
    });

    expect(trackProductListViewedSpecMock).toHaveBeenCalledTimes(1);

    attributesState = {
      favorite_category: "Accessories",
      favorite_designer: "Arc Studio",
    };

    await act(async () => {
      root?.render(<HomePage />);
    });

    expect(trackProductListViewedSpecMock).toHaveBeenCalledTimes(2);

    const firstCall = trackProductListViewedSpecMock.mock.calls[0]?.[0];
    const secondCall = trackProductListViewedSpecMock.mock.calls[1]?.[0];

    expect(firstCall?.context.map((entry: { data: { product_id: string } }) => entry.data.product_id)).not.toEqual(
      secondCall?.context.map((entry: { data: { product_id: string } }) => entry.data.product_id)
    );
  });
});
