// @vitest-environment jsdom

import Ajv from "ajv";
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { products } from "@/data/products";
import type { CesMessengerElement } from "@/types/ces-messenger";

import messageContextSchema from "./__fixtures__/com.snowplow.agent.tracking.message_context.1-0-0.json";
import messageReceivedSchema from "./__fixtures__/com.snowplow.agent.tracking.message_received.1-0-0.json";
import messageSentSchema from "./__fixtures__/com.snowplow.agent.tracking.message_sent.1-0-0.json";

const {
  trackSelfDescribingEventMock,
  getDomainSessionIdMock,
  setSnowplowTurnIdMock,
  trackProductListClickedSpecMock,
} = vi.hoisted(() => ({
  trackSelfDescribingEventMock: vi.fn(),
  getDomainSessionIdMock: vi.fn<() => string | undefined>(),
  setSnowplowTurnIdMock: vi.fn(),
  trackProductListClickedSpecMock: vi.fn(),
}));

vi.mock("@snowplow/browser-tracker", () => ({
  trackSelfDescribingEvent: trackSelfDescribingEventMock,
  getDomainSessionId: getDomainSessionIdMock,
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOMAIN_SESSION_ID = "6f1d2c3b-4a5e-4f60-8b71-9c0d1e2f3a4b";

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

/** Mirrors the JSON entry ces-messenger writes under sessionStorage["bidi-widget-session"]. */
function seedWidgetSession(sessionId: string) {
  window.sessionStorage.setItem(
    "bidi-widget-session",
    JSON.stringify({ messages: [], sessionId, chatUiStatus: "OPEN", toolMessageQueue: [] })
  );
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
    getDomainSessionIdMock.mockReturnValue(DOMAIN_SESSION_ID);
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

  it("tracks one message_sent per user input, using the turn id armed on the widget before the send, with an increasing index", async () => {
    mount();

    dispatchOn(window, "ces-user-input-entered", { input: "Hello there" });
    await act(async () => {
      await Promise.resolve();
    });

    expect(trackSelfDescribingEventMock).toHaveBeenCalledTimes(1);
    // Armed at mount, then re-armed for the next turn once this send consumed it.
    expect(setSnowplowTurnIdMock).toHaveBeenCalledTimes(2);
    expect(setSnowplowTurnIdMock.mock.invocationCallOrder[0]).toBeLessThan(
      trackSelfDescribingEventMock.mock.invocationCallOrder[0]
    );

    const call = trackSelfDescribingEventMock.mock.calls[0];
    expect(schemaOf(call)).toBe(
      "iglu:com.snowplow.agent.tracking/message_sent/jsonschema/1-0-0"
    );

    expect(dataOf(call)).toEqual({
      session_id: DOMAIN_SESSION_ID,
      sent_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });

    const messageContext = findEntity(call, "message_context")!;
    expect(messageContext.data).toEqual({
      message_id: expect.stringMatching(UUID_RE),
      message_role: "user",
      message_length: "Hello there".length,
      message_preview: "Hello there",
      message_index: 1,
      conversation_turn: 1,
    });

    const conversation = findEntity(call, "conversation")!;
    const turnId = setSnowplowTurnIdMock.mock.calls[0][1] as string;
    expect(conversation.data).toMatchObject({
      turn_id: turnId,
      turn_index: 1,
      channel: "web_widget",
    });

    dispatchOn(window, "ces-user-input-entered", { input: "Another one" });
    await act(async () => {
      await Promise.resolve();
    });

    expect(trackSelfDescribingEventMock).toHaveBeenCalledTimes(2);
    const secondCall = trackSelfDescribingEventMock.mock.calls[1];
    const secondTurnId = setSnowplowTurnIdMock.mock.calls[1][1] as string;
    expect(secondTurnId).not.toBe(turnId);
    expect(findEntity(secondCall, "message_context")!.data).toMatchObject({
      message_index: 2,
      conversation_turn: 2,
    });
    expect(findEntity(secondCall, "message_context")!.data.message_id).not.toBe(
      messageContext.data.message_id
    );
  });

  it("tracks message_received on the first chunk only, sharing the turn id with a positive response time", async () => {
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);

    mount();
    dispatchOn(window, "ces-user-input-entered", { input: "Find me a coat" });
    await act(async () => {
      await Promise.resolve();
    });
    const turnId = setSnowplowTurnIdMock.mock.calls[0][1] as string;

    now = 1_500;
    dispatchOn(window, "ces-text-received", { outputs: [{ text: "Here is a coat." }] });
    await act(async () => {
      await Promise.resolve();
    });

    expect(trackSelfDescribingEventMock).toHaveBeenCalledTimes(2);
    const receivedCall = trackSelfDescribingEventMock.mock.calls[1];
    expect(schemaOf(receivedCall)).toBe(
      "iglu:com.snowplow.agent.tracking/message_received/jsonschema/1-0-0"
    );
    expect(dataOf(receivedCall)).toEqual({
      session_id: DOMAIN_SESSION_ID,
      invocation_id: turnId,
      response_time_ms: 500,
      tool_calls_count: 0,
      received_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    expect(findEntity(receivedCall, "message_context")!.data).toMatchObject({
      message_id: expect.stringMatching(UUID_RE),
      message_role: "assistant",
      message_length: "Here is a coat.".length,
      message_index: 1,
      conversation_turn: 1,
    });
    expect(findEntity(receivedCall, "conversation")!.data).toMatchObject({
      turn_id: turnId,
    });

    // A later chunk for the same turn must be ignored.
    dispatchOn(window, "ces-payload-received", { outputs: [{ text: "more" }] });
    await act(async () => {
      await Promise.resolve();
    });
    expect(trackSelfDescribingEventMock).toHaveBeenCalledTimes(2);
  });

  it("caps response_time_ms at the schema maximum of 300000 when a reply arrives after five minutes", async () => {
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);

    mount();
    dispatchOn(window, "ces-user-input-entered", { input: "Slow one" });
    await act(async () => {
      await Promise.resolve();
    });

    now = 1_000 + 600_000;
    dispatchOn(window, "ces-text-received", { outputs: [{ text: "Finally." }] });
    await act(async () => {
      await Promise.resolve();
    });

    expect(dataOf(trackSelfDescribingEventMock.mock.calls[1]).response_time_ms).toBe(300_000);
  });

  it("caps message previews at 100 characters while still reporting the full length", async () => {
    mount();
    const longText = "a".repeat(150);

    dispatchOn(window, "ces-user-input-entered", { input: longText });
    await act(async () => {
      await Promise.resolve();
    });

    const messageContext = findEntity(trackSelfDescribingEventMock.mock.calls[0], "message_context")!;
    expect(messageContext.data.message_length).toBe(150);
    expect(messageContext.data.message_preview).toBe("a".repeat(100));
  });

  it("omits the preview when the public toggle is disabled, but still reports length", async () => {
    vi.stubEnv("NEXT_PUBLIC_WIDGET_MESSAGE_PREVIEWS_ENABLED", "false");
    mount();

    dispatchOn(window, "ces-user-input-entered", { input: "Hello" });
    await act(async () => {
      await Promise.resolve();
    });

    const messageContext = findEntity(trackSelfDescribingEventMock.mock.calls[0], "message_context")!;
    expect(messageContext.data.message_preview).toBeNull();
    expect(messageContext.data.message_length).toBe(5);
  });

  it("reports the chat session id on the conversation entity, or null when the widget has not stored one", async () => {
    mount();
    dispatchOn(window, "ces-user-input-entered", { input: "Hi" });
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      findEntity(trackSelfDescribingEventMock.mock.calls[0], "conversation")!.data.chat_session_id
    ).toBeNull();

    seedWidgetSession("chat-session-42");
    dispatchOn(window, "ces-user-input-entered", { input: "Hi again" });
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      findEntity(trackSelfDescribingEventMock.mock.calls[1], "conversation")!.data.chat_session_id
    ).toBe("chat-session-42");
  });

  // ces-messenger dispatches ces-user-input-entered only AFTER the request has
  // gone (it awaits the network send first), so an id set inside that handler
  // rides on the NEXT turn's request. The hook therefore arms the id ahead of
  // the send and consumes it when the send is reported.
  it("arms the next turn id on the widget at mount, uses it for the turn the shopper then sends, and re-arms a fresh one", async () => {
    mount();

    expect(setSnowplowTurnIdMock).toHaveBeenCalledTimes(1);
    const armedTurnId = setSnowplowTurnIdMock.mock.calls[0][1] as string;
    expect(armedTurnId).toMatch(UUID_RE);
    expect(trackSelfDescribingEventMock).not.toHaveBeenCalled();

    dispatchOn(window, "ces-user-input-entered", { input: "first" });
    await act(async () => {
      await Promise.resolve();
    });

    expect(findEntity(trackSelfDescribingEventMock.mock.calls[0], "conversation")!.data.turn_id).toBe(
      armedTurnId
    );
    expect(setSnowplowTurnIdMock).toHaveBeenCalledTimes(2);
    const nextTurnId = setSnowplowTurnIdMock.mock.calls[1][1] as string;
    expect(nextTurnId).toMatch(UUID_RE);
    expect(nextTurnId).not.toBe(armedTurnId);

    dispatchOn(window, "ces-text-received", { outputs: [{ text: "reply" }] });
    await act(async () => {
      await Promise.resolve();
    });
    expect(dataOf(trackSelfDescribingEventMock.mock.calls[1]).invocation_id).toBe(armedTurnId);

    dispatchOn(window, "ces-user-input-entered", { input: "second" });
    await act(async () => {
      await Promise.resolve();
    });
    expect(findEntity(trackSelfDescribingEventMock.mock.calls[2], "conversation")!.data.turn_id).toBe(
      nextTurnId
    );
  });

  describe("ces-messenger event detail shapes (captured from the live widget, 2026-09-23)", () => {
    it("reads the user's message from the {input} detail of ces-user-input-entered", async () => {
      mount();

      dispatchOn(window, "ces-user-input-entered", {
        input: "DQ check from Claude: what scarves do you have?",
      });
      await act(async () => {
        await Promise.resolve();
      });

      const messageContext = findEntity(trackSelfDescribingEventMock.mock.calls[0], "message_context")!;
      expect(messageContext.data).toMatchObject({
        message_role: "user",
        message_length: "DQ check from Claude: what scarves do you have?".length,
        message_preview: "DQ check from Claude: what scarves do you have?",
      });
    });

    it("reads the assistant's text from outputs[].text of the raw backend message on ces-text-received", async () => {
      mount();
      dispatchOn(window, "ces-user-input-entered", { input: "what scarves do you have?" });
      await act(async () => {
        await Promise.resolve();
      });

      dispatchOn(window, "ces-text-received", {
        outputs: [
          { text: "We have three scarves in the winter salon.", turnIndex: 1 },
          { turnCompleted: true, turnIndex: 1, payload: { richContent: [] } },
        ],
      });
      await act(async () => {
        await Promise.resolve();
      });

      const messageContext = findEntity(trackSelfDescribingEventMock.mock.calls[1], "message_context")!;
      expect(messageContext.data).toMatchObject({
        message_role: "assistant",
        message_length: "We have three scarves in the winter salon.".length,
        message_preview: "We have three scarves in the winter salon.",
      });
    });

    it("falls back to the sessionOutput.text and detectIntentResponse wire shapes the widget also unmarshals", async () => {
      mount();

      dispatchOn(window, "ces-user-input-entered", { input: "one" });
      await act(async () => {
        await Promise.resolve();
      });
      dispatchOn(window, "ces-text-received", {
        sessionOutput: { text: "Bidi session reply", turnIndex: 1, turnCompleted: true },
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(
        findEntity(trackSelfDescribingEventMock.mock.calls[1], "message_context")!.data.message_preview
      ).toBe("Bidi session reply");

      dispatchOn(window, "ces-user-input-entered", { input: "two" });
      await act(async () => {
        await Promise.resolve();
      });
      dispatchOn(window, "ces-text-received", {
        detectIntentResponse: {
          responseType: "FINAL",
          queryResult: {
            responseMessages: [{ text: { text: ["Dialogflow", "reply"] } }, { payload: {} }],
          },
        },
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(
        findEntity(trackSelfDescribingEventMock.mock.calls[3], "message_context")!.data.message_preview
      ).toBe("Dialogflow\nreply");
    });

    it("reads the CES session id from the widget's bidi-widget-session storage entry and uses it as session_id", async () => {
      const cesSessionId = "644698e5-1b2c-4d3e-9f80-a1b2c3d4e5f6";
      window.sessionStorage.setItem(
        "bidi-widget-session",
        JSON.stringify({
          messages: [{ type: "USER", text: "hi" }],
          sessionId: cesSessionId,
          chatUiStatus: "OPEN",
          toolMessageQueue: [],
        })
      );
      mount();

      dispatchOn(window, "ces-user-input-entered", { input: "hi" });
      await act(async () => {
        await Promise.resolve();
      });

      const call = trackSelfDescribingEventMock.mock.calls[0];
      expect(findEntity(call, "conversation")!.data.chat_session_id).toBe(cesSessionId);
      expect(dataOf(call).session_id).toBe(cesSessionId);
    });

    it("degrades to a null chat session id and the domain session fallback when the storage entry is not JSON", async () => {
      window.sessionStorage.setItem("bidi-widget-session", "not json");
      mount();

      dispatchOn(window, "ces-user-input-entered", { input: "hi" });
      await act(async () => {
        await Promise.resolve();
      });

      const call = trackSelfDescribingEventMock.mock.calls[0];
      expect(findEntity(call, "conversation")!.data.chat_session_id).toBeNull();
      expect(dataOf(call).session_id).toBe(DOMAIN_SESSION_ID);
    });
  });

  describe("session_id resolution", () => {
    const CHAT_SESSION_UUID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

    async function sendAndReceive() {
      dispatchOn(window, "ces-user-input-entered", { input: "Hi" });
      await act(async () => {
        await Promise.resolve();
      });
      dispatchOn(window, "ces-text-received", { outputs: [{ text: "Hello" }] });
      await act(async () => {
        await Promise.resolve();
      });
      return trackSelfDescribingEventMock.mock.calls.map((call) => dataOf(call).session_id);
    }

    it("prefers a UUID-shaped chat session id, on both message_sent and message_received", async () => {
      seedWidgetSession(CHAT_SESSION_UUID);
      mount();

      expect(await sendAndReceive()).toEqual([CHAT_SESSION_UUID, CHAT_SESSION_UUID]);
    });

    it("skips a non-UUID chat session id for session_id but still reports it on the conversation entity", async () => {
      seedWidgetSession("chat-session-42");
      mount();

      expect(await sendAndReceive()).toEqual([DOMAIN_SESSION_ID, DOMAIN_SESSION_ID]);
      expect(
        findEntity(trackSelfDescribingEventMock.mock.calls[0], "conversation")!.data.chat_session_id
      ).toBe("chat-session-42");
    });

    it("falls back to the shopper's domain session id when no chat session id is available", async () => {
      mount();

      expect(await sendAndReceive()).toEqual([DOMAIN_SESSION_ID, DOMAIN_SESSION_ID]);
    });

    it("resolves session_id once per turn, so a chat session id that appears mid-turn does not split the pair", async () => {
      mount();
      dispatchOn(window, "ces-user-input-entered", { input: "Hi" });
      await act(async () => {
        await Promise.resolve();
      });

      seedWidgetSession(CHAT_SESSION_UUID);
      dispatchOn(window, "ces-text-received", { outputs: [{ text: "Hello" }] });
      await act(async () => {
        await Promise.resolve();
      });

      const [sent, received] = trackSelfDescribingEventMock.mock.calls;
      expect(dataOf(sent).session_id).toBe(DOMAIN_SESSION_ID);
      expect(dataOf(received).session_id).toBe(DOMAIN_SESSION_ID);
    });

    it("falls back to one UUID per mount when neither id is available", async () => {
      getDomainSessionIdMock.mockReturnValue(undefined);
      mount();

      const ids = await sendAndReceive();
      expect(ids[0]).toMatch(UUID_RE);
      expect(ids[1]).toBe(ids[0]);

      dispatchOn(window, "ces-user-input-entered", { input: "Again" });
      await act(async () => {
        await Promise.resolve();
      });
      expect(dataOf(trackSelfDescribingEventMock.mock.calls[2]).session_id).toBe(ids[0]);
    });
  });

  describe("Iglu Central schema conformance", () => {
    // ajv 6 speaks the draft-04 dialect these Iglu schemas use and ships the
    // "uuid" and "date-time" format checks built in. The self-describing
    // "$schema" URI points at Iglu's meta-schema, which ajv cannot fetch, so
    // it is stripped along with the Iglu "self" block before compiling.
    function compile(schema: Record<string, unknown>) {
      const plain = { ...schema };
      delete plain.$schema;
      delete plain.self;
      return new Ajv({ allErrors: true, schemaId: "auto" }).compile(plain);
    }
    const validateSent = compile(messageSentSchema);
    const validateReceived = compile(messageReceivedSchema);
    const validateContext = compile(messageContextSchema);

    function expectValid(validate: ReturnType<typeof compile>, data: unknown) {
      const ok = validate(data);
      expect(validate.errors ?? []).toEqual([]);
      expect(ok).toBe(true);
    }

    it("emits message_sent and message_received payloads and message_context entities that validate", async () => {
      mount();
      dispatchOn(window, "ces-user-input-entered", { input: "Show me coats" });
      await act(async () => {
        await Promise.resolve();
      });
      dispatchOn(window, "ces-text-received", { outputs: [{ text: "Here are some coats." }] });
      await act(async () => {
        await Promise.resolve();
      });

      const [sent, received] = trackSelfDescribingEventMock.mock.calls;
      expectValid(validateSent, dataOf(sent));
      expectValid(validateReceived, dataOf(received));
      expectValid(validateContext, findEntity(sent, "message_context")!.data);
      expectValid(validateContext, findEntity(received, "message_context")!.data);
    });

    it("still validates with previews disabled and an unparseable message detail", async () => {
      vi.stubEnv("NEXT_PUBLIC_WIDGET_MESSAGE_PREVIEWS_ENABLED", "false");
      mount();
      dispatchOn(window, "ces-user-input-entered", { nothing: "useful" });
      await act(async () => {
        await Promise.resolve();
      });

      const [sent] = trackSelfDescribingEventMock.mock.calls;
      expectValid(validateSent, dataOf(sent));
      expectValid(validateContext, findEntity(sent, "message_context")!.data);
    });
  });

  it("defers tracking until the tracker is ready, instead of dropping it", async () => {
    let resolveReady: () => void = () => {};
    trackerReadyPromise = new Promise((resolve) => {
      resolveReady = resolve;
    });

    mount();
    dispatchOn(window, "ces-user-input-entered", { input: "Hello" });
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

    dispatchOn(element, "ces-user-input-entered", { input: "Hi" });
    await act(async () => {
      await Promise.resolve();
    });
    expect(trackSelfDescribingEventMock).toHaveBeenCalledTimes(1);

    dispatchOn(element, "ces-text-received", { outputs: [{ text: "hello" }] });
    await act(async () => {
      await Promise.resolve();
    });
    expect(trackSelfDescribingEventMock).toHaveBeenCalledTimes(2);
  });

  it("dedupes a single event instance that bubbles from the element to the window listener", async () => {
    const element = mount();

    act(() => {
      element.dispatchEvent(
        new CustomEvent("ces-user-input-entered", { detail: { input: "hi" }, bubbles: true })
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(trackSelfDescribingEventMock).toHaveBeenCalledTimes(1);
    // One arm at mount plus one re-arm for the single deduped send.
    expect(setSnowplowTurnIdMock).toHaveBeenCalledTimes(2);
  });

  it("tears down listeners on unmount without throwing or tracking further events", async () => {
    mount();
    const { root, container } = mounted.pop()!;
    act(() => {
      root.unmount();
    });

    expect(() => {
      dispatchOn(window, "ces-user-input-entered", { input: "after unmount" });
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
