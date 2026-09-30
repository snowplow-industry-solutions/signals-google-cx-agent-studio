"use client";

import { getDomainSessionId, trackSelfDescribingEvent } from "@snowplow/browser-tracker";
import { useEffect, type RefObject } from "react";

import { setSnowplowTurnId } from "@/components/Widget/CesMessengerWidget";
import { waitForSnowplowTracker } from "@/components/Analytics/SnowplowProvider";
import { safeCardUrl, type ProductCardData } from "@/components/Widget/widgetCards";
import { getProductBySlug } from "@/data/products";
import { trackProductListClickedSpec, trackProductListViewedSpec } from "@/snowtype/snowplow";
import type { CesMessengerElement } from "@/types/ces-messenger";
import type { Product } from "@/types/commerce";
import { logSignalsDemo } from "@/utils/demo";
import {
  createProductListClickedTrackingProps,
  createProductListViewedTrackingProps,
} from "@/utils/snowtypeTracking";

/**
 * Conversation-tracking hook: browser-side `message_sent` /
 * `message_received` events (Iglu Central `com.snowplow.agent.tracking`)
 * plus concierge card click and impression tracking, following the defensive
 * window-and-element listener pattern already used by
 * useWidgetLoadingIndicator.ts and waiting on the same tracker-ready signal
 * as the rest of the storefront (SnowplowProvider.waitForSnowplowTracker) so
 * a message fired before tracker init is deferred, not dropped.
 *
 * Schema URIs are declared as constants here rather than resolved through
 * generated Snowtype helpers. The tracking plan declares message_sent /
 * message_received event specifications, but switching this hook to generated
 * helpers needs a real seed + `snowtype:generate` against an org (see
 * storefront/README.md's Snowtype section). The server-side module
 * (src/utils/agentTracking.ts) likewise keeps its own Iglu Central constants.
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
/** `list_type` for the concierge placement, alongside the storefront's `homepage` / `collection` / `product_detail`. */
export const CONCIERGE_LIST_TYPE = "agent_recommendation";

const MAX_PREVIEW_LENGTH = 100;
/** message_received 1-0-0 caps response_time_ms at 300000; a longer wait must clamp, not fail validation. */
const MAX_RESPONSE_TIME_MS = 300_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Off only when explicitly disabled; on by default. */
function previewsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_WIDGET_MESSAGE_PREVIEWS_ENABLED !== "false";
}

/** Caps a message preview at 100 chars, or omits it when the public toggle is off. */
export function capMessagePreview(text: string): string | null {
  return previewsEnabled() ? text.slice(0, MAX_PREVIEW_LENGTH) : null;
}

/**
 * ces-messenger dispatches `ces-user-input-entered` on window with
 * `detail: { input: <the typed text> }` (read from the served gstatic
 * ces-messenger.js; the script is unversioned, so this is the observed shape,
 * not a contract). Falls back to an empty string
 * rather than throwing -- the message is still tracked, just with a zero
 * length/empty preview.
 */
function extractUserInputText(detail: unknown): string {
  if (detail && typeof detail === "object") {
    const input = (detail as Record<string, unknown>).input;
    if (typeof input === "string") {
      return input;
    }
  }
  return "";
}

/**
 * ces-messenger dispatches `ces-text-received` / `ces-payload-received` with
 * `detail` = the raw backend message, not the text. Its own unmarshallers
 * accept three wire shapes, tried here in the same order; the live widget
 * sends the first, `{ outputs: [{ text, turnIndex },
 * { turnCompleted, payload }] }`. Every text output of one message is joined
 * with a newline.
 */
function extractAssistantText(detail: unknown): string {
  if (!detail || typeof detail !== "object") {
    return "";
  }
  const message = detail as Record<string, unknown>;

  if (message.outputs !== undefined) {
    const outputs = Array.isArray(message.outputs) ? message.outputs : [message.outputs];
    return joinTexts(outputs.map((output) => (output as Record<string, unknown> | null)?.text));
  }

  const sessionOutput = message.sessionOutput as Record<string, unknown> | undefined;
  if (typeof sessionOutput?.text === "string") {
    return sessionOutput.text;
  }

  const responseMessages = (
    (message.detectIntentResponse as Record<string, unknown> | undefined)?.queryResult as
      | Record<string, unknown>
      | undefined
  )?.responseMessages;
  if (Array.isArray(responseMessages)) {
    return joinTexts(
      responseMessages.flatMap((responseMessage) => {
        const texts = (responseMessage as Record<string, unknown> | null)?.text as
          | Record<string, unknown>
          | undefined;
        return Array.isArray(texts?.text) ? texts.text : [];
      })
    );
  }

  return "";
}

function joinTexts(candidates: unknown[]): string {
  return candidates.filter((text): text is string => typeof text === "string").join("\n");
}

/**
 * ces-messenger persists its chat state under one sessionStorage entry,
 * `bidi-widget-session`, as JSON `{ messages, sessionId, chatUiStatus,
 * toolMessageQueue }` (read from the served script).
 * `sessionId` is the CES session UUID: the tail of the `config.session`
 * resource name on the wire and the value the server-side tool endpoints
 * emit as `agent_context.session_id`. The widget saves this entry when it
 * appends the user's message, before the network send, so it is already
 * present when `ces-user-input-entered` fires for the very first turn.
 * Anything missing or malformed degrades to the documented null fallback
 * (when unavailable, the conversation entity's field is null).
 */
const CHAT_SESSION_STORAGE_KEY = "bidi-widget-session";

function getChatSessionId(): string | null {
  try {
    const raw = window.sessionStorage.getItem(CHAT_SESSION_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const sessionId = (parsed as Record<string, unknown>).sessionId;
      if (typeof sessionId === "string" && sessionId.length > 0) {
        return sessionId;
      }
    }
  } catch {
    // sessionStorage can throw in locked-down browser contexts (e.g. some
    // privacy modes) and the entry may not be JSON; treat both as
    // unavailable rather than crashing the widget.
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
 * Maps a card URL's `/products/<slug>` path to the catalog product it points
 * at, or undefined when the URL is not a product page or the slug is unknown.
 * Shared by the click and impression trackers so both resolve cards the same
 * way.
 */
function resolveCardProduct(url: URL): Product | undefined {
  const match = /^\/products\/([^/?#]+)\/?$/.exec(url.pathname);
  const slug = match?.[1];
  return slug ? getProductBySlug(slug) : undefined;
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
  const product = resolveCardProduct(url);

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

/**
 * Counts agent-rendered product cards as impressions of the concierge list,
 * so the placement has `product_list_viewed` to pair with the
 * `product_list_clicked` events trackConciergeCardClick already fires. Every
 * other storefront placement fires both via useTrackDemoProductListView.
 *
 * Card `uri`s are model-emitted text, so each is resolved through the same
 * safeCardUrl gate the renderer uses (relative to the current page, since
 * widget payloads carry the deployed storefront's absolute URLs -- see the
 * `navigate` comment in useWidgetTokenRenderer) and then matched against the
 * catalog by slug. Cards that do not resolve are logged and dropped, and a
 * batch with nothing resolvable is not tracked at all, mirroring how the
 * click tracker never invents a product.
 */
export function trackConciergeCardsShown(items: ProductCardData[]): void {
  const products: Product[] = [];
  for (const item of items) {
    const url = item.uri ? safeCardUrl(item.uri, window.location.href) : null;
    const product = url ? resolveCardProduct(url) : undefined;
    if (product) {
      products.push(product);
    } else {
      logSignalsDemo("Concierge card did not resolve to a catalog product; not counted as an impression", {
        uri: item.uri,
      });
    }
  }

  if (products.length === 0) {
    return;
  }

  void (async () => {
    await waitForSnowplowTracker();
    trackProductListViewedSpec(
      createProductListViewedTrackingProps(
        CONCIERGE_LIST_ID,
        CONCIERGE_LIST_NAME,
        CONCIERGE_LIST_TYPE,
        products
      )
    );
    logSignalsDemo("Tracked concierge cards as a product list view", {
      productIds: products.map((product) => product.id),
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

    /**
     * Mints the id for the shopper's NEXT turn and hands it to the widget
     * (CesMessengerWidget's setSnowplowTurnId) so that turn's request carries it as
     * `snowplow_turn_id`. ces-messenger dispatches `ces-user-input-entered`
     * only after awaiting the network send, so an id set inside that handler
     * arrived one turn late (turn N+1's request carried turn N's id and the
     * agent's server-side events paired with the wrong browser messages).
     * Armed once at mount and again as soon as a send consumes it.
     */
    const armNextTurnId = (): string => {
      const turnId = crypto.randomUUID();
      const element = ref.current;
      if (element) {
        setSnowplowTurnId(element, turnId);
      } else {
        logSignalsDemo(
          "ces-messenger element not ready; snowplow_turn_id not armed on the widget",
          { turnId }
        );
      }
      return turnId;
    };
    let armedTurnId = armNextTurnId();

    const handleUserInput = (event: Event) => {
      if (event === lastSendEvent) {
        return;
      }
      lastSendEvent = event;

      // The widget has already sent this turn's request with the armed id;
      // consume it here and arm the next one straight away.
      const turnId = armedTurnId;
      armedTurnId = armNextTurnId();
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

      const text = extractUserInputText((event as CustomEvent).detail);
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

    // Records the FIRST receive event of a turn only. On the live widget the
    // first backend message already carried the full text plus the payload,
    // so this is adequate for now; if the agent ever streams partials, or
    // sends a payload-only message ahead of the text, the text would need
    // accumulating until `turnCompleted` instead.
    const handleReceived = (event: Event) => {
      const turn = currentTurn;
      if (!turn || turn.receivedForTurn) {
        return;
      }
      turn.receivedForTurn = true;

      const responseTimeMs = Math.min(Date.now() - turn.sentAt, MAX_RESPONSE_TIME_MS);
      const text = extractAssistantText((event as CustomEvent).detail);
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
              // Schema-required placeholder the browser cannot know: the
              // agent's tool calls run server-side and never pass through
              // the widget (ces-tool-call-received fires only for
              // client-side tools). The true count is derived in SQL from
              // the server-side tool_execution events grouped by
              // agent_context.invocation_id (the analytics turn-level
              // reconstruction), which matches this event's invocation_id
              // because the turn id is armed ahead of the send.
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
