// @vitest-environment jsdom

import { act } from "react";
import { useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { logSignalsDemoMock, trackConciergeCardClickMock } = vi.hoisted(() => ({
  logSignalsDemoMock: vi.fn(),
  trackConciergeCardClickMock: vi.fn(),
}));

vi.mock("@/utils/demo", () => ({
  logSignalsDemo: logSignalsDemoMock,
}));

vi.mock("@/components/Widget/useWidgetConversationTracking", () => ({
  trackConciergeCardClick: trackConciergeCardClickMock,
}));

// useWidgetTokenRenderer calls next/navigation's useRouter, which requires a
// mounted app router; render the hook bare, as CesMessengerWidget.test.tsx
// does for the same reason.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import type { CesMessengerElement } from "@/types/ces-messenger";

import { useWidgetTokenRenderer } from "./useWidgetTokenRenderer";

/**
 * Bare harness: no real <ces-messenger> custom element, no shadow root —
 * only the payload-registration path (attachPayloadPath) is under test
 * here, so a plain div stands in for the element.
 */
function Harness({
  onElement,
}: {
  onElement: (element: CesMessengerElement) => void;
}) {
  const elementRef = useRef<CesMessengerElement | null>(null);
  useWidgetTokenRenderer(elementRef);
  return (
    <div
      // A callback ref runs during React's commit/layout phase, strictly
      // before useEffect fires — so methods assigned via onElement are
      // already present on the node the first time attachPayloadPath runs.
      // No polling wait needed.
      ref={(node) => {
        if (!node) return;
        const element = node as unknown as CesMessengerElement;
        elementRef.current = element;
        onElement(element);
      }}
    />
  );
}

const mounted: { root: Root; container: HTMLDivElement }[] = [];

function mount(methods: Partial<CesMessengerElement>): CesMessengerElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });

  let element!: CesMessengerElement;
  act(() => {
    root.render(
      <Harness
        onElement={(el) => {
          Object.assign(el, methods);
          element = el;
        }}
      />
    );
  });
  return element;
}

function normalizedContext() {
  return {
    kind: "details" as const,
    items: [
      {
        title: "Silk Twill Square Scarf",
        subtitle: "",
        price: "",
        uri: "https://example.com/products/scarf",
        imageUri: "",
      },
    ],
  };
}

describe("useWidgetTokenRenderer — payload-mode registration", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
  });

  afterEach(() => {
    while (mounted.length) {
      const { root, container } = mounted.pop()!;
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });

  it("falls back to anchor cards and skips the rich-message handler when the build lacks registerRichMessageHandler", () => {
    const registerTemplate = vi.fn();
    const registerHook = vi.fn();
    const element = mount({ registerTemplate, registerHook });

    expect(registerTemplate).toHaveBeenCalledTimes(1);
    expect(element.registerRichMessageHandler).toBeUndefined();

    const template = registerTemplate.mock.calls[0][1] as (
      context: unknown
    ) => string;
    const host = document.createElement("div");
    host.innerHTML = template(normalizedContext());
    const anchor = host.querySelector("a");
    expect(anchor).not.toBeNull();
    expect(anchor!.getAttribute("href")).toBe(
      "https://example.com/products/scarf"
    );
  });

  it("keeps data-uri div cards and registers the rich-message click handler when the build supports it", () => {
    const registerTemplate = vi.fn();
    const registerHook = vi.fn();
    const registerRichMessageHandler = vi.fn();
    mount({ registerTemplate, registerHook, registerRichMessageHandler });

    expect(registerRichMessageHandler).toHaveBeenCalledTimes(1);

    const template = registerTemplate.mock.calls[0][1] as (
      context: unknown
    ) => string;
    const host = document.createElement("div");
    host.innerHTML = template(normalizedContext());
    expect(host.querySelector("a")).toBeNull();
    expect(host.querySelector("[data-uri]")).not.toBeNull();
  });

  it("logs and leaves template_id unset when a claimed payload fails normalization", () => {
    const registerTemplate = vi.fn();
    const registerHook = vi.fn();
    mount({ registerTemplate, registerHook });

    expect(registerHook).toHaveBeenCalledTimes(1);
    const hookCallback = registerHook.mock.calls[0][1] as (
      payload: unknown
    ) => boolean;

    // Claims the payload (type matches product_detail*) but has no title,
    // so normalizeWidgetPayload returns null.
    const payload: { type: string; template_id?: unknown } = {
      type: "product_detail_carousel",
    };
    const result = hookCallback(payload);

    expect(result).toBe(true);
    expect(payload.template_id).toBeUndefined();
    expect(logSignalsDemoMock).toHaveBeenCalledWith(
      expect.stringContaining("unrenderable"),
      { type: "product_detail_carousel" }
    );
  });

  it("tracks a concierge card click when a rich-message card navigates internally", () => {
    const registerTemplate = vi.fn();
    const registerHook = vi.fn();
    const registerRichMessageHandler = vi.fn();
    mount({ registerTemplate, registerHook, registerRichMessageHandler });

    const clickHandler = registerRichMessageHandler.mock.calls[0][1] as (
      message: unknown,
      clicked: Element
    ) => unknown;

    const card = document.createElement("div");
    card.setAttribute("data-uri", "/products/noir-double-breasted-blazer");
    document.body.appendChild(card);

    clickHandler({}, card);

    expect(trackConciergeCardClickMock).toHaveBeenCalledTimes(1);
    expect(trackConciergeCardClickMock.mock.calls[0][0]).toBeInstanceOf(URL);
    expect(
      (trackConciergeCardClickMock.mock.calls[0][0] as URL).pathname
    ).toBe("/products/noir-double-breasted-blazer");

    card.remove();
  });

  it("does not log for a payload it never claims", () => {
    const registerTemplate = vi.fn();
    const registerHook = vi.fn();
    mount({ registerTemplate, registerHook });

    const hookCallback = registerHook.mock.calls[0][1] as (
      payload: unknown
    ) => boolean;

    expect(hookCallback({ type: "some_other_widget" })).toBe(true);
    expect(logSignalsDemoMock).not.toHaveBeenCalled();
  });
});
