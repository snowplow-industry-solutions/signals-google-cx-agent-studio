"use client";

import { getDomainSessionId, trackSelfDescribingEvent } from "@snowplow/browser-tracker";
import { useEffect, type RefObject } from "react";

import { setSnowplowTurnId } from "@/components/Widget/CesMessengerWidget";
import { waitForSnowplowTracker } from "@/components/Analytics/SnowplowProvider";
import { getProductBySlug } from "@/data/products";
import { trackProductListClickedSpec } from "@/snowtype/snowplow";
import type { CesMessengerElement } from "@/types/ces-messenger";
import { logSignalsDemo } from "@/utils/demo";
import { createProductListClickedTrackingProps } from "@/utils/snowtypeTracking";

/**
 * Issue 25's conversation-tracking hook: browser-side `message_sent` /
 * `message_received` events (Iglu Central `com.snowplow.agent.tracking`)
 * plus concierge card-click tracking, following the defensive
 * window-and-element listener pattern already used by
 * useWidgetLoadingIndicator.ts and waiting on the same tracker-ready signal
 * as the rest of the storefront (SnowplowProvider.waitForSnowplowTracker) so
 * a message fired before tracker init is deferred, not dropped.
 *
 * Schema URIs are declared as constants here rather than resolved through
 * generated Snowtype helpers. Issue #26 added the message_sent/message_received
 * event specifications to the tracking plan; switching this hook to generated
 * helpers is a human checkpoint (needs a real seed + `snowtype:generate`
 * against an org -- see storefront/README.md's Snowtype section), mirroring
 * how the server-side module (src/utils/agentTracking.ts) keeps its own Iglu
 * Central constants regardless.
 *
 * Payload field names follow the published 1-0-0 schemas exactly. All three
 * set `additionalProperties: false`, so a misnamed or extra key makes
 * enrichment reject the whole event (and every entity riding on it). The
 * schema JSON is committed under __fixtures__/ and the test validates the
 * built payloads against it.
 */

const MESSAGE_SENT_SCHEMA = "iglu:com.snowplow.agent.tracking/message_sent/jsonschema/1-0-0";
const MESSAGE_RECEIVED_SCHEMA = "iglu:com.snowplow.agent.tracking/message_received/jsonschema/1-0-0";
const MESSAGE_CONTEXT_SCHEMA = "iglu:com.snowplow.agent.tracking/message_context/jsonschema/1-0-0";
const CONVERSATION_SCHEMA = "iglu:com.snowplow_demo.fashion/conversation/jsonschema/1-0-0";

const SEND_EVENT = "ces-user-input-entered";
const RECEIVE_EVENTS = ["ces-text-received", "ces-payload-received"] as const;

const CHANNEL = "web_widget";

export const CONCIERGE_LIST_ID = "concierge_recommendations";
export const CONCIERGE_LIST_NAME = "Concierge Recommendations";

const MAX_PREVIEW_LENGTH = 100;
/** message_received 1-0-0 caps response_time_ms at 300000; a longer wait must clamp, not fail validation. */
const MAX_RESPONSE_TIME_MS = 300_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Off only when explicitly disabled; on by default (spec #18/#25). */
function previewsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_WIDGET_MESSAGE_PREVIEWS_ENABLED !== "false";
}

/** Caps a message preview at 100 chars, or omits it when the public toggle is off. */
export function capMessagePreview(text: string): string | null {
  return previewsEnabled() ? text.slice(0, MAX_PREVIEW_LENGTH) : null;
}

/**
 * ces-messenger's user-input/text/payload event detail shapes are
 * undocumented (same gstatic-script caveat as the event names themselves --
 * see useWidgetLoadingIndicator.ts) and unverifiable in this sandbox.
 * Assumed shape: a plain string, or an object carrying the text under one of
 * these common keys. Falls back to an empty string rather than throwing --
 * the message is still tracked, just with a zero length/empty preview.
 */
function extractMessageText(detail: unknown): string {
  if (typeof detail === "string") {
    return detail;
  }
  if (detail && typeof detail === "object") {
    const obj = detail as Record<string, unknown>;
    for (const key of ["text", "message", "value", "content"]) {
      const candidate = obj[key];
      if (typeof candidate === "string") {
        return candidate;
      }
    }
  }
  return "";
}

/**
 * ces-messenger persists its own chat session id in sessionStorage; the key
 * name is undocumented and unverifiable without a live embed. Tries the
 * assumed key first, then falls back to scanning for any key that looks
 * like it, in case a given build namespaces it (e.g. by deployment id). A
 * human should confirm against a live embed and adjust here if it differs;
 * until then this degrades to the documented null fallback (spec #18:
 * "if unavailable, the conversation entity's field is null").
 */
const CHAT_SESSION_STORAGE_KEY = "ces-messenger-session-id";

function getChatSessionId(): string | null {
  try {
    const direct = window.sessionStorage.getItem(CHAT_SESSION_STORAGE_KEY);
    if (direct) {
      return direct;
    }

    for (let i = 0; i < window.sessionStorage.length; i++) {
      const key = window.sessionStorage.key(i);
      if (key && /ces-messenger.*session/i.test(key)) {
        return window.sessionStorage.getItem(key);
      }
    }
  } catch {
    // sessionStorage can throw in locked-down browser contexts (e.g. some
    // privacy modes); treat as unavailable rather than crashing the widget.
  }
  return null;
}

/**
 * `session_id` on message_sent/message_received is required and must be a
 * UUID. Mirrors the server-side fallback order in src/utils/agentTracking.ts
 * (chat session id, then the shopper's domain_sessionid, then a fresh UUID)
 * so browser message events join server-side agent events on the same value.
 * The chat session id is only used when it is UUID-shaped, since a non-UUID
 * value would fail schema validation; it still appears verbatim on the
 * `conversation` entity. The final fallback is minted once per hook mount so
 * every message in that mount shares it. Resolved once per turn, at send time,
 * so a chat session id that ces-messenger persists mid-turn cannot give the
 * message_sent/message_received pair different session ids.
 */
function resolveSessionId(chatSessionId: string | null, mountSessionId: string): string {
  if (chatSessionId && UUID_RE.test(chatSessionId)) {
    return chatSessionId;
  }
  const domainSessionId = getDomainSessionId();
  if (domainSessionId && UUID_RE.test(domainSessionId)) {
    return domainSessionId;
  }
  return mountSessionId;
}

function buildConversationEntity(chatSessionId: string | null, turnId: string, turnIndex: number) {
  return {
    schema: CONVERSATION_SCHEMA,
    data: {
      chat_session_id: chatSessionId,
      turn_id: turnId,
      turn_index: turnIndex,
      channel: CHANNEL,
    },
  };
}

function buildMessageContextEntity(
  role: "user" | "assistant",
  text: string,
  index: number,
  turn: number
) {
  return {
    schema: MESSAGE_CONTEXT_SCHEMA,
    data: {
      message_id: crypto.randomUUID(),
      message_role: role,
      message_length: text.length,
      message_preview: capMessagePreview(text),
      message_index: index,
      conversation_turn: turn,
    },
  };
}

interface TurnState {
  turnId: string;
  sentAt: number;
  messageIndex: number;
  turnIndex: number;
  receivedForTurn: boolean;
  /** Set once the tracker is ready and message_sent has resolved it; reused by message_received. */
  sessionId: string | null;
}

/**
 * Resolves a card-click navigation URL's `/products/<slug>` path against the
 * catalog and, when it matches, fires the existing product-list-clicked
 * event (generated Snowtype helper) with the concierge list id/name. An
 * unresolvable slug (no match, or not a product URL at all) is logged, not
 * tracked. Exported so useWidgetTokenRenderer's `navigate` -- the single
 * place the storefront's widget renderer actually navigates on a card
 * click -- can call it directly.
 */
export function trackConciergeCardClick(url: URL): void {
  const match = /^\/products\/([^/?#]+)\/?$/.exec(url.pathname);
  const slug = match?.[1];
  const product = slug ? getProductBySlug(slug) : undefined;

  if (!product) {
    logSignalsDemo("Concierge card click did not resolve to a catalog product", {
      pathname: url.pathname,
    });
    return;
  }

  void (async () => {
    await waitForSnowplowTracker();
    trackProductListClickedSpec(
      createProductListClickedTrackingProps(CONCIERGE_LIST_ID, CONCIERGE_LIST_NAME, product)
    );
    logSignalsDemo("Tracked concierge card click as a product list click", {
      productId: product.id,
    });
  })();
}

export function useWidgetConversationTracking(ref: RefObject<CesMessengerElement | null>) {
  useEffect(() => {
    let messageIndex = 0;
    let turnIndex = 0;
    let currentTurn: TurnState | null = null;
    let lastSendEvent: Event | null = null;
    const mountSessionId = crypto.randomUUID();

    const handleUserInput = (event: Event) => {
      if (event === lastSendEvent) {
        return;
      }
      lastSendEvent = event;

      const turnId = crypto.randomUUID();
      messageIndex += 1;
      turnIndex += 1;
      const turn: TurnState = {
        turnId,
        sentAt: Date.now(),
        messageIndex,
        turnIndex,
        receivedForTurn: false,
        sessionId: null,
      };
      currentTurn = turn;

      // Must be set on the widget before the send is tracked (issue #25
      // acceptance criterion), using issue #22's exported setter.
      const element = ref.current;
      if (element) {
        setSnowplowTurnId(element, turnId);
      } else {
        logSignalsDemo(
          "ces-messenger user-input event fired before the element was ready; snowplow_turn_id not set for this turn"
        );
      }

      const text = extractMessageText((event as CustomEvent).detail);
      const chatSessionId = getChatSessionId();

      void (async () => {
        await waitForSnowplowTracker();
        turn.sessionId = resolveSessionId(chatSessionId, mountSessionId);
        trackSelfDescribingEvent({
          event: {
            schema: MESSAGE_SENT_SCHEMA,
            data: {
              session_id: turn.sessionId,
              sent_at: new Date(turn.sentAt).toISOString(),
            },
          },
          context: [
            buildMessageContextEntity("user", text, turn.messageIndex, turn.turnIndex),
            buildConversationEntity(chatSessionId, turn.turnId, turn.turnIndex),
          ],
        });
        logSignalsDemo("Tracked message_sent", { turnId: turn.turnId, index: turn.messageIndex });
      })();
    };

    const handleReceived = (event: Event) => {
      const turn = currentTurn;
      if (!turn || turn.receivedForTurn) {
        return;
      }
      turn.receivedForTurn = true;

      const responseTimeMs = Math.min(Date.now() - turn.sentAt, MAX_RESPONSE_TIME_MS);
      const text = extractMessageText((event as CustomEvent).detail);
      const chatSessionId = getChatSessionId();

      void (async () => {
        await waitForSnowplowTracker();
        trackSelfDescribingEvent({
          event: {
            schema: MESSAGE_RECEIVED_SCHEMA,
            data: {
              session_id: turn.sessionId ?? resolveSessionId(chatSessionId, mountSessionId),
              invocation_id: turn.turnId,
              response_time_ms: responseTimeMs,
              tool_calls_count: 0,
              received_at: new Date().toISOString(),
            },
          },
          context: [
            buildMessageContextEntity("assistant", text, turn.messageIndex, turn.turnIndex),
            buildConversationEntity(chatSessionId, turn.turnId, turn.turnIndex),
          ],
        });
        logSignalsDemo("Tracked message_received", {
          turnId: turn.turnId,
          responseTimeMs,
        });
      })();
    };

    const element = ref.current;
    const listenerTargets: EventTarget[] = element ? [window, element] : [window];

    for (const target of listenerTargets) {
      target.addEventListener(SEND_EVENT, handleUserInput);
      for (const name of RECEIVE_EVENTS) {
        target.addEventListener(name, handleReceived);
      }
    }

    return () => {
      for (const target of listenerTargets) {
        target.removeEventListener(SEND_EVENT, handleUserInput);
        for (const name of RECEIVE_EVENTS) {
          target.removeEventListener(name, handleReceived);
        }
      }
    };
  }, [ref]);
}
