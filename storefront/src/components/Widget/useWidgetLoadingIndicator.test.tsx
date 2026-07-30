// @vitest-environment jsdom

import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CesMessengerElement } from "@/types/ces-messenger";

import { replaceWidgetTokensIn } from "./widgetCards";
import { createPartialTokenVisibility } from "./widgetTokenVisibility";
import { useWidgetLoadingIndicator } from "./useWidgetLoadingIndicator";

const INDICATOR_SELECTOR = "[data-widget-loading-indicator]";

/**
 * Bare harness mirroring useWidgetTokenRenderer.test.tsx: a callback ref
 * runs during React's commit/layout phase, strictly before useEffect fires,
 * so the element (and its shadow root) is already attached the first time
 * the hook's effect runs — no polling wait needed.
 */
function Harness({
  onElement,
}: {
  onElement: (element: CesMessengerElement) => void;
}) {
  const elementRef = useRef<CesMessengerElement | null>(null);
  useWidgetLoadingIndicator(elementRef);
  return (
    <div
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

/** Mounts the harness with a real shadow root seeded with the live
 * ces-messenger message-list shape (`ul > li.from-bot|from-user`), same
 * fixture shape as widgetCards.test.ts / widgetTokenVisibility.test.ts. */
function mount(): { element: CesMessengerElement; shadowRoot: ShadowRoot } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });

  let element!: CesMessengerElement;
  act(() => {
    root.render(<Harness onElement={(el) => (element = el)} />);
  });

  const shadowRoot = element.attachShadow({ mode: "open" });
  const list = document.createElement("ul");
  const li = document.createElement("li");
  li.className = "from-bot text-response";
  li.appendChild(document.createElement("span"));
  list.appendChild(li);
  shadowRoot.appendChild(list);

  return { element, shadowRoot };
}

function dispatchOn(target: EventTarget, name: string) {
  act(() => {
    target.dispatchEvent(new Event(name));
  });
}

describe("useWidgetLoadingIndicator", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    while (mounted.length) {
      const { root, container } = mounted.pop()!;
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });

  it("shows the indicator promptly after a send event", () => {
    const { shadowRoot } = mount();
    expect(shadowRoot.querySelector(INDICATOR_SELECTOR)).toBeNull();

    dispatchOn(window, "ces-message-sent");

    expect(shadowRoot.querySelector(INDICATOR_SELECTOR)).not.toBeNull();
  });

  it("does not stack duplicate bubbles when several send events fire for one message", () => {
    const { shadowRoot } = mount();

    dispatchOn(window, "ces-user-input-entered");
    dispatchOn(window, "ces-text-sent");
    dispatchOn(window, "ces-message-sent");

    expect(shadowRoot.querySelectorAll(INDICATOR_SELECTOR)).toHaveLength(1);
  });

  it.each([
    "ces-message-received",
    "ces-text-received",
    "ces-payload-received",
  ])("removes the indicator on %s", (eventName) => {
    const { shadowRoot } = mount();
    dispatchOn(window, "ces-message-sent");
    expect(shadowRoot.querySelector(INDICATOR_SELECTOR)).not.toBeNull();

    dispatchOn(window, eventName);

    expect(shadowRoot.querySelector(INDICATOR_SELECTOR)).toBeNull();
  });

  it("also responds to events dispatched on the element itself, not just window", () => {
    const { element, shadowRoot } = mount();

    dispatchOn(element, "ces-message-sent");
    expect(shadowRoot.querySelector(INDICATOR_SELECTOR)).not.toBeNull();

    dispatchOn(element, "ces-text-received");
    expect(shadowRoot.querySelector(INDICATOR_SELECTOR)).toBeNull();
  });

  it("swaps to a 'still working' cue after ~30s with no reply", () => {
    vi.useFakeTimers();
    const { shadowRoot } = mount();

    dispatchOn(window, "ces-message-sent");
    const bubble = shadowRoot.querySelector(INDICATOR_SELECTOR);
    expect(bubble?.getAttribute("data-widget-loading-indicator")).toBe(
      "typing"
    );

    act(() => {
      vi.advanceTimersByTime(29999);
    });
    expect(bubble?.getAttribute("data-widget-loading-indicator")).toBe(
      "typing"
    );

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(bubble?.getAttribute("data-widget-loading-indicator")).toBe(
      "stalled"
    );
    // Still present, not removed.
    expect(shadowRoot.querySelector(INDICATOR_SELECTOR)).not.toBeNull();
  });

  it("a late reply after the 'still working' cue still clears the indicator", () => {
    vi.useFakeTimers();
    const { shadowRoot } = mount();

    dispatchOn(window, "ces-message-sent");
    act(() => {
      vi.advanceTimersByTime(30000);
    });
    expect(
      shadowRoot
        .querySelector(INDICATOR_SELECTOR)
        ?.getAttribute("data-widget-loading-indicator")
    ).toBe("stalled");

    dispatchOn(window, "ces-text-received");

    expect(shadowRoot.querySelector(INDICATOR_SELECTOR)).toBeNull();
  });

  it.each(["ces-messenger-disconnected", "ces-authentication-error"])(
    "clears the indicator on %s",
    (eventName) => {
      const { shadowRoot } = mount();
      dispatchOn(window, "ces-message-sent");
      expect(shadowRoot.querySelector(INDICATOR_SELECTOR)).not.toBeNull();

      dispatchOn(window, eventName);

      expect(shadowRoot.querySelector(INDICATOR_SELECTOR)).toBeNull();
    }
  );

  it("clears a stalled indicator on disconnect", () => {
    vi.useFakeTimers();
    const { shadowRoot } = mount();
    dispatchOn(window, "ces-message-sent");
    act(() => {
      vi.advanceTimersByTime(30000);
    });

    dispatchOn(window, "ces-messenger-disconnected");

    expect(shadowRoot.querySelector(INDICATOR_SELECTOR)).toBeNull();
  });

  it("shows a fresh indicator (with its own timeout) for a new message after a prior one cleared", () => {
    vi.useFakeTimers();
    const { shadowRoot } = mount();

    dispatchOn(window, "ces-message-sent");
    dispatchOn(window, "ces-text-received");
    expect(shadowRoot.querySelector(INDICATOR_SELECTOR)).toBeNull();

    dispatchOn(window, "ces-message-sent");
    expect(
      shadowRoot
        .querySelector(INDICATOR_SELECTOR)
        ?.getAttribute("data-widget-loading-indicator")
    ).toBe("typing");

    act(() => {
      vi.advanceTimersByTime(30000);
    });
    expect(
      shadowRoot
        .querySelector(INDICATOR_SELECTOR)
        ?.getAttribute("data-widget-loading-indicator")
    ).toBe("stalled");
  });

  it("tears down listeners and the indicator on unmount", () => {
    vi.useFakeTimers();
    const { shadowRoot, element } = mount();
    dispatchOn(window, "ces-message-sent");
    expect(shadowRoot.querySelector(INDICATOR_SELECTOR)).not.toBeNull();

    const { root, container } = mounted.pop()!;
    act(() => {
      root.unmount();
    });

    expect(shadowRoot.querySelector(INDICATOR_SELECTOR)).toBeNull();

    // Post-unmount events and the (cleared) timeout must not throw or
    // resurrect the indicator.
    expect(() => {
      dispatchOn(window, "ces-message-sent");
      dispatchOn(element, "ces-message-sent");
      vi.advanceTimersByTime(30000);
    }).not.toThrow();
    expect(shadowRoot.querySelector(INDICATOR_SELECTOR)).toBeNull();

    container.remove();
  });

  it("coexists with the widget token renderer: no interference with token replacement or partial-token visibility, idempotent under repeated mutation ticks", () => {
    const { shadowRoot } = mount();
    const partialVisibility = createPartialTokenVisibility();

    dispatchOn(window, "ces-message-sent");
    const bubble = shadowRoot.querySelector(INDICATOR_SELECTOR);
    expect(bubble).not.toBeNull();

    // Simulate several renderer mutation-observer ticks running over the
    // same shadow root while the indicator sits in it.
    for (let tick = 0; tick < 3; tick++) {
      const replaced = replaceWidgetTokensIn(shadowRoot);
      partialVisibility.process(shadowRoot);
      expect(replaced).toBe(0);
    }

    // Untouched by the renderer passes: still exactly one indicator, still
    // visible (partial-token hiding never targeted it).
    expect(shadowRoot.querySelectorAll(INDICATOR_SELECTOR)).toHaveLength(1);
    expect((bubble as HTMLElement).style.visibility).toBe("");

    partialVisibility.dispose();
  });
});
