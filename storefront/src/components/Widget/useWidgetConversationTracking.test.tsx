// @vitest-environment jsdom

import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { products } from "@/data/products";
import type { CesMessengerElement } from "@/types/ces-messenger";

const {
  trackSelfDescribingEventMock,
  setSnowplowTurnIdMock,
  trackProductListClickedSpecMock,
} = vi.hoisted(() => ({
  trackSelfDescribingEventMock: vi.fn(),
  setSnowplowTurnIdMock: vi.fn(),
  trackProductListClickedSpecMock: vi.fn(),
}));

vi.mock("@snowplow/browser-tracker", () => ({
  trackSelfDescribingEvent: trackSelfDescribingEventMock,
}));

vi.mock("@/components/Widget/CesMessengerWidget", () => ({
  setSnowplowTurnId: setSnowplowTurnIdMock,
}));

vi.mock("@/snowtype/snowplow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/snowtype/snowplow")>();
  return {
    ...actual,
    trackProductListClickedSpec: trackProductListClickedSpecMock,
  };
});

let trackerReadyPromise: Promise<void> = Promise.resolve();

vi.mock("@/components/Analytics/SnowplowProvider", () => ({
  waitForSnowplowTracker: () => trackerReadyPromise,
}));

import {
  CONCIERGE_LIST_ID,
  CONCIERGE_LIST_NAME,
  trackConciergeCardClick,
  useWidgetConversationTracking,
} from "./useWidgetConversationTracking";

const PRODUCT = products[0];

function Harness({
  onElement,
}: {
  onElement: (element: CesMessengerElement) => void;
}) {
  const elementRef = useRef<CesMessengerElement | null>(null);
  useWidgetConversationTracking(elementRef);
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

function mount(): CesMessengerElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });

  let element!: CesMessengerElement;
  act(() => {
    root.render(<Harness onElement={(el) => (element = el)} />);
  });
  return element;
}

function dispatchOn(target: EventTarget, name: string, detail?: unknown) {
  act(() => {
    target.dispatchEvent(new CustomEvent(name, { detail }));
  });
}

function schemaOf(call: unknown[]): string {
  const arg = call[0] as { event: { schema: string } };
  return arg.event.schema;
}

function dataOf(call: unknown[]): Record<string, unknown> {
  const arg = call[0] as { event: { data: Record<string, unknown> } };
  return arg.event.data;
}

function contextOf(call: unknown[]): Array<{ schema: string; data: Record<string, unknown> }> {
  const arg = call[0] as { context: Array<{ schema: string; data: Record<string, unknown> }> };
  return arg.context;
}

function findEntity(
  call: unknown[],
  schemaSuffix: string
): { schema: string; data: Record<string, unknown> } | undefined {
  return contextOf(call).find((entity) => entity.schema.includes(schemaSuffix));
}

describe("useWidgetConversationTracking", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    trackerReadyPromise = Promise.resolve();
    window.sessionStorage.clear();
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

  it("tracks one message_sent per user input, sets the turn id on the widget first, with an increasing index", async () => {
    mount();

    dispatchOn(window, "ces-user-input-entered", { text: "Hello there" });
    await act(async () => {
      await Promise.resolve();
    });

    expect(trackSelfDescribingEventMock).toHaveBeenCalledTimes(1);
    expect(setSnowplowTurnIdMock).toHaveBeenCalledTimes(1);
    expect(setSnowplowTurnIdMock.mock.invocationCallOrder[0]).toBeLessThan(
      trackSelfDescribingEventMock.mock.invocationCallOrder[0]
    );

    const call = trackSelfDescribingEventMock.mock.calls[0];
    expect(schemaOf(call)).toBe(
      "iglu:com.snowplow.agent.tracking/message_sent/jsonschema/1-0-0"
    );

    const messageContext = findEntity(call, "message_context")!;
    expect(messageContext.data).toMatchObject({
      role: "user",
      length: "Hello there".length,
      preview: "Hello there",
      index: 1,
      turn: 1,
    });

    const conversation = findEntity(call, "conversation")!;
    const turnId = setSnowplowTurnIdMock.mock.calls[0][1] as string;
    expect(conversation.data).toMatchObject({
      turn_id: turnId,
      turn_index: 1,
      channel: "web_widget",
    });

    dispatchOn(window, "ces-user-input-entered", { text: "Another one" });
    await act(async () => {
      await Promise.resolve();
    });

    expect(trackSelfDescribingEventMock).toHaveBeenCalledTimes(2);
    const secondCall = trackSelfDescribingEventMock.mock.calls[1];
    const secondTurnId = setSnowplowTurnIdMock.mock.calls[1][1] as string;
    expect(secondTurnId).not.toBe(turnId);
    expect(findEntity(secondCall, "message_context")!.data).toMatchObject({
      index: 2,
      turn: 2,
    });
  });

  it("tracks message_received on the first chunk only, sharing the turn id with a positive response time", async () => {
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);

    mount();
    dispatchOn(window, "ces-user-input-entered", { text: "Find me a coat" });
    await act(async () => {
      await Promise.resolve();
    });
    const turnId = setSnowplowTurnIdMock.mock.calls[0][1] as string;

    now = 1_500;
    dispatchOn(window, "ces-text-received", { text: "Here is a coat." });
    await act(async () => {
      await Promise.resolve();
    });

    expect(trackSelfDescribingEventMock).toHaveBeenCalledTimes(2);
    const receivedCall = trackSelfDescribingEventMock.mock.calls[1];
    expect(schemaOf(receivedCall)).toBe(
      "iglu:com.snowplow.agent.tracking/message_received/jsonschema/1-0-0"
    );
    expect(dataOf(receivedCall)).toMatchObject({
      invocation_id: turnId,
      response_time_ms: 500,
      tool_calls_count: 0,
    });
    expect(findEntity(receivedCall, "message_context")!.data).toMatchObject({
      role: "assistant",
    });
    expect(findEntity(receivedCall, "conversation")!.data).toMatchObject({
      turn_id: turnId,
    });

    // A later chunk for the same turn must be ignored.
    dispatchOn(window, "ces-payload-received", { text: "more" });
    await act(async () => {
      await Promise.resolve();
    });
    expect(trackSelfDescribingEventMock).toHaveBeenCalledTimes(2);
  });

  it("caps message previews at 100 characters while still reporting the full length", async () => {
    mount();
    const longText = "a".repeat(150);

    dispatchOn(window, "ces-user-input-entered", { text: longText });
    await act(async () => {
      await Promise.resolve();
    });

    const messageContext = findEntity(trackSelfDescribingEventMock.mock.calls[0], "message_context")!;
    expect(messageContext.data.length).toBe(150);
    expect(messageContext.data.preview).toBe("a".repeat(100));
  });

  it("omits the preview when the public toggle is disabled, but still reports length", async () => {
    vi.stubEnv("NEXT_PUBLIC_WIDGET_MESSAGE_PREVIEWS_ENABLED", "false");
    mount();

    dispatchOn(window, "ces-user-input-entered", { text: "Hello" });
    await act(async () => {
      await Promise.resolve();
    });

    const messageContext = findEntity(trackSelfDescribingEventMock.mock.calls[0], "message_context")!;
    expect(messageContext.data.preview).toBeNull();
    expect(messageContext.data.length).toBe(5);
  });

  it("reads the chat session id from the widget's session-storage entry, or null when unavailable", async () => {
    mount();
    dispatchOn(window, "ces-user-input-entered", { text: "Hi" });
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      findEntity(trackSelfDescribingEventMock.mock.calls[0], "conversation")!.data.chat_session_id
    ).toBeNull();

    window.sessionStorage.setItem("ces-messenger-session-id", "chat-session-42");
    dispatchOn(window, "ces-user-input-entered", { text: "Hi again" });
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      findEntity(trackSelfDescribingEventMock.mock.calls[1], "conversation")!.data.chat_session_id
    ).toBe("chat-session-42");
  });

  it("defers tracking until the tracker is ready, instead of dropping it", async () => {
    let resolveReady: () => void = () => {};
    trackerReadyPromise = new Promise((resolve) => {
      resolveReady = resolve;
    });

    mount();
    dispatchOn(window, "ces-user-input-entered", { text: "Hello" });
    await act(async () => {
      await Promise.resolve();
    });
    expect(trackSelfDescribingEventMock).not.toHaveBeenCalled();

    resolveReady();
    await act(async () => {
      await trackerReadyPromise;
      await Promise.resolve();
    });
    expect(trackSelfDescribingEventMock).toHaveBeenCalledTimes(1);
  });

  it("also responds to events dispatched on the element itself, not just window", async () => {
    const element = mount();

    dispatchOn(element, "ces-user-input-entered", { text: "Hi" });
    await act(async () => {
      await Promise.resolve();
    });
    expect(trackSelfDescribingEventMock).toHaveBeenCalledTimes(1);

    dispatchOn(element, "ces-text-received", { text: "hello" });
    await act(async () => {
      await Promise.resolve();
    });
    expect(trackSelfDescribingEventMock).toHaveBeenCalledTimes(2);
  });

  it("tears down listeners on unmount without throwing or tracking further events", async () => {
    mount();
    const { root, container } = mounted.pop()!;
    act(() => {
      root.unmount();
    });

    expect(() => {
      dispatchOn(window, "ces-user-input-entered", { text: "after unmount" });
    }).not.toThrow();
    await act(async () => {
      await Promise.resolve();
    });
    expect(trackSelfDescribingEventMock).not.toHaveBeenCalled();
    container.remove();
  });
});

describe("trackConciergeCardClick", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    trackerReadyPromise = Promise.resolve();
  });

  it("fires the product list clicked helper with the concierge list id/name for a resolvable product URL", async () => {
    trackConciergeCardClick(new URL(`https://example.com/products/${PRODUCT.slug}`));
    await Promise.resolve();
    await Promise.resolve();

    expect(trackProductListClickedSpecMock).toHaveBeenCalledTimes(1);
    const props = trackProductListClickedSpecMock.mock.calls[0][0];
    expect(props).toMatchObject({
      list_id: CONCIERGE_LIST_ID,
      list_name: CONCIERGE_LIST_NAME,
      product_id: PRODUCT.id,
    });
  });

  it("tracks nothing for a URL whose slug does not match a catalog product", async () => {
    trackConciergeCardClick(new URL("https://example.com/products/not-a-real-product"));
    await Promise.resolve();
    await Promise.resolve();

    expect(trackProductListClickedSpecMock).not.toHaveBeenCalled();
  });

  it("tracks nothing for a non-product URL", async () => {
    trackConciergeCardClick(new URL("https://example.com/collections/winter-salon"));
    await Promise.resolve();
    await Promise.resolve();

    expect(trackProductListClickedSpecMock).not.toHaveBeenCalled();
  });
});
