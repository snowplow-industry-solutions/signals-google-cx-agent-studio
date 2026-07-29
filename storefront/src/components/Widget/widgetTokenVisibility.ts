/**
 * Streaming-suppression helper for `useWidgetTokenRenderer` (issue 09 review,
 * finding: `findPartialTokenStart` was a dead export — a mid-stream partial
 * `{@Widget: productCa…` rendered as raw text until the token completed).
 *
 * `replaceWidgetTokensIn` only ever swaps *complete* tokens for cards, by
 * design: ces-messenger owns the streaming text nodes and rewrites them on
 * every tick, so nothing in this codebase may mutate their content — an
 * earlier attempt to patch the partial text in place fought the component's
 * own rewrites and was abandoned. This module instead hides the *nearest
 * ancestor element* of a partial text node (`visibility: hidden`, not
 * `display: none` or removal) while the token is incomplete, and restores
 * the element's prior inline `visibility` once the partial resolves —
 * either because the token completed (replaceWidgetTokensIn already swapped
 * it for a card by the time `process` runs) or because the text simply
 * moved on without it.
 *
 * A never-completing partial (e.g. literal prose that happens to start with
 * the marker and never closes) would otherwise blank that element forever,
 * since nothing would ever fire the "text no longer has a partial" unhide
 * condition — so every newly-hidden element also gets a one-shot safety
 * timer that force-reveals it after `hideTimeoutMs`.
 */

import { findPartialTokenTextNodes } from "@/components/Widget/widgetCards";
import { findPartialTokenStart } from "@/utils/widgetTokens";

/** Force-reveal a partial that never resolves on its own. */
const DEFAULT_HIDE_TIMEOUT_MS = 5000;

export interface PartialTokenVisibility {
  /**
   * Call once per process pass, after `replaceWidgetTokensIn` has run on the
   * same `root`. Unhides any tracked element whose text no longer contains
   * a partial, then hides the nearest ancestor element of every remaining
   * partial text node (skipping elements already tracked, so an
   * ongoing/still-streaming partial doesn't keep resetting its safety
   * timer).
   */
  process(root: Node): void;
  /** Restores every currently-hidden element and clears all timers. Call on
   * observer teardown/unmount — an in-flight partial must not leave its
   * message permanently blank just because streaming was interrupted. */
  dispose(): void;
}

interface HiddenEntry {
  previousVisibility: string;
  timer: ReturnType<typeof setTimeout>;
}

export function createPartialTokenVisibility(
  hideTimeoutMs: number = DEFAULT_HIDE_TIMEOUT_MS
): PartialTokenVisibility {
  const hidden = new Map<HTMLElement, HiddenEntry>();

  const reveal = (element: HTMLElement, entry: HiddenEntry): void => {
    clearTimeout(entry.timer);
    element.style.visibility = entry.previousVisibility;
    hidden.delete(element);
  };

  const process = (root: Node): void => {
    // Unhide first: a token that completed this pass has already been
    // replaced with its card by replaceWidgetTokensIn, so the tracked
    // element's aggregate text (card text + any surrounding prose) no
    // longer contains a partial marker at all.
    for (const [element, entry] of hidden) {
      if (findPartialTokenStart(element.textContent ?? "") === -1) {
        reveal(element, entry);
      }
    }

    // Then hide: any text node still ending in a partial invocation gets
    // its nearest ancestor element hidden, unless that element is already
    // tracked (an ongoing partial keeps its original timer rather than
    // getting a fresh one every mutation-observer tick).
    for (const textNode of findPartialTokenTextNodes(root)) {
      const element = textNode.parentElement;
      if (!element || hidden.has(element)) continue;

      const previousVisibility = element.style.visibility;
      element.style.visibility = "hidden";
      const entry = {} as HiddenEntry;
      entry.previousVisibility = previousVisibility;
      entry.timer = setTimeout(() => reveal(element, entry), hideTimeoutMs);
      hidden.set(element, entry);
    }
  };

  const dispose = (): void => {
    for (const [element, entry] of hidden) {
      reveal(element, entry);
    }
  };

  return { process, dispose };
}
