// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { replaceWidgetTokensIn } from "./widgetCards";
import { createPartialTokenVisibility } from "./widgetTokenVisibility";

// Captured verbatim from the live agent's runSession output (docs/runbook.md
// §11.5) — same fixture widgetCards.test.ts uses for replaceWidgetTokensIn.
const TOKEN =
  '{@Widget: productDetails(payload: {title: "Silk Twill Square Scarf", subtitle: "Atelier Lune", price: "$340", uri: "https://x.test/products/scarf", imageUris: ["https://img.test/scarf.jpg"]})}';

/** Mirrors the live ces-messenger structure (li.from-bot > span > #text): a
 * single text node carrying the whole message, token included. */
function messageNode(text: string): { root: HTMLElement; span: HTMLElement } {
  const root = document.createElement("ul");
  const li = document.createElement("li");
  li.className = "from-bot text-response";
  const span = document.createElement("span");
  span.textContent = text;
  li.appendChild(span);
  root.appendChild(li);
  return { root, span };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("createPartialTokenVisibility", () => {
  it("hides the nearest ancestor element of a text node ending in a partial token", () => {
    const { root, span } = messageNode(`Here: ${TOKEN.slice(0, 25)}`);
    createPartialTokenVisibility().process(root);
    expect(span.style.visibility).toBe("hidden");
  });

  it("never hides an element whose text has no widget marker", () => {
    const { root, span } = messageNode("Just some plain concierge prose.");
    createPartialTokenVisibility().process(root);
    expect(span.style.visibility).toBe("");
  });

  it("unhides and leaves the rendered card once the token completes and is re-processed", () => {
    const { root, span } = messageNode(`Here: ${TOKEN.slice(0, 25)}`);
    const visibility = createPartialTokenVisibility();

    replaceWidgetTokensIn(root);
    visibility.process(root);
    expect(span.style.visibility).toBe("hidden");

    // Simulate the next streaming tick: ces-messenger rewrites the text
    // node's data in place (same node reference) to the completed token —
    // this suite never mutates it itself, only the "component" stand-in.
    span.firstChild!.textContent = `Here: ${TOKEN}`;
    const replaced = replaceWidgetTokensIn(root);
    visibility.process(root);

    expect(replaced).toBe(1);
    expect(span.style.visibility).toBe("");
    expect(
      span.querySelector("[data-widget-card=productDetails]")
    ).not.toBeNull();
  });

  it("restores the element's prior inline visibility value, not a forced 'visible'", () => {
    const { root, span } = messageNode(`Here: ${TOKEN.slice(0, 15)}`);
    span.style.visibility = "collapse"; // arbitrary pre-existing inline value
    const visibility = createPartialTokenVisibility();

    replaceWidgetTokensIn(root);
    visibility.process(root);
    expect(span.style.visibility).toBe("hidden");

    span.firstChild!.textContent = `Here: ${TOKEN}`;
    replaceWidgetTokensIn(root);
    visibility.process(root);
    expect(span.style.visibility).toBe("collapse");
  });

  it("re-hides an element when a new partial starts right after the previous one resolved", () => {
    const { root, span } = messageNode(`A ${TOKEN.slice(0, 15)}`);
    const visibility = createPartialTokenVisibility();

    replaceWidgetTokensIn(root);
    visibility.process(root);
    expect(span.style.visibility).toBe("hidden");

    // Completes with nothing trailing — fully unhides.
    span.firstChild!.textContent = `A ${TOKEN}`;
    replaceWidgetTokensIn(root);
    visibility.process(root);
    expect(span.style.visibility).toBe("");

    // A second widget call starts streaming in right after the first card.
    span.appendChild(document.createTextNode(` B ${TOKEN.slice(0, 15)}`));
    visibility.process(root);
    expect(span.style.visibility).toBe("hidden");
  });

  it("hides the shared ancestor element when a partial trails a complete token in the same original text node", () => {
    // Documented trade-off: "nearest ancestor element" is the granularity
    // the task brief specifies, so a partial that starts later in the same
    // bubble as an already-rendered card hides that card too — finer-grained
    // per-token wrapping would require mutating the streaming text node,
    // which is the one thing this module must never do.
    const { root, span } = messageNode(`${TOKEN} then ${TOKEN.slice(0, 20)}`);
    const visibility = createPartialTokenVisibility();

    const replaced = replaceWidgetTokensIn(root);
    visibility.process(root);

    expect(replaced).toBe(1);
    expect(
      span.querySelector("[data-widget-card=productDetails]")
    ).not.toBeNull();
    expect(span.style.visibility).toBe("hidden");
  });

  it("tracks two elements independently when two messages stream at once", () => {
    const first = messageNode(`Msg1 ${TOKEN.slice(0, 20)}`);
    const second = messageNode("Msg2 plain prose, no marker here.");
    const combinedRoot = document.createElement("div");
    combinedRoot.appendChild(first.root);
    combinedRoot.appendChild(second.root);

    createPartialTokenVisibility().process(combinedRoot);

    expect(first.span.style.visibility).toBe("hidden");
    expect(second.span.style.visibility).toBe("");
  });

  it("force-reveals a partial that never completes after the safety timeout", () => {
    vi.useFakeTimers();
    const { root, span } = messageNode(`Here: ${TOKEN.slice(0, 25)}`);
    createPartialTokenVisibility(5000).process(root);
    expect(span.style.visibility).toBe("hidden");

    vi.advanceTimersByTime(4999);
    expect(span.style.visibility).toBe("hidden");

    vi.advanceTimersByTime(1);
    expect(span.style.visibility).toBe("");
  });

  it("does not extend the safety timer on repeated ticks of the same ongoing partial", () => {
    vi.useFakeTimers();
    const { root, span } = messageNode(`Here: ${TOKEN.slice(0, 10)}`);
    const visibility = createPartialTokenVisibility(5000);
    visibility.process(root);
    expect(span.style.visibility).toBe("hidden");

    vi.advanceTimersByTime(3000);
    // More streaming ticks: text grows but stays a partial. If re-hiding
    // reset the timer here, the deadline would never arrive.
    span.firstChild!.textContent = `Here: ${TOKEN.slice(0, 20)}`;
    visibility.process(root);
    expect(span.style.visibility).toBe("hidden");

    vi.advanceTimersByTime(2000); // total 5000ms since the *first* hide
    expect(span.style.visibility).toBe("");
  });

  it("dispose() immediately restores visibility and cancels the safety timer", () => {
    vi.useFakeTimers();
    const { root, span } = messageNode(`Here: ${TOKEN.slice(0, 15)}`);
    const visibility = createPartialTokenVisibility(5000);
    visibility.process(root);
    expect(span.style.visibility).toBe("hidden");

    visibility.dispose();
    expect(span.style.visibility).toBe("");

    // The cancelled timer must not fire and touch the element again later.
    vi.advanceTimersByTime(10000);
    expect(span.style.visibility).toBe("");
  });
});
