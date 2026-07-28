// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getDomainSessionIdMock } = vi.hoisted(() => ({
  getDomainSessionIdMock: vi.fn(),
}));

vi.mock("@snowplow/browser-tracker", () => ({
  getDomainSessionId: getDomainSessionIdMock,
}));

vi.mock("next/script", () => ({
  default: () => null,
}));

import type { CesMessengerElement } from "@/types/ces-messenger";
import { CesMessengerWidget } from "@/components/Widget/CesMessengerWidget";

function queryWidget(container: HTMLElement) {
  return container.querySelector("ces-messenger") as CesMessengerElement | null;
}

describe("CesMessengerWidget", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    vi.stubEnv(
      "NEXT_PUBLIC_CES_DEPLOYMENT_ID",
      "projects/p/locations/l/apps/a/deployments/d"
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }
    container.remove();
    root = null;
    vi.unstubAllEnvs();
  });

  it("passes domain_sessionid to setQueryParameters once the widget loads", async () => {
    getDomainSessionIdMock.mockReturnValue("session-abc");
    root = createRoot(container);

    await act(async () => {
      root?.render(<CesMessengerWidget />);
    });

    const element = queryWidget(container);
    expect(element).not.toBeNull();

    const setQueryParametersMock = vi.fn();
    element!.setQueryParameters = setQueryParametersMock;

    await act(async () => {
      // The real widget fires this on window, not on the element.
      window.dispatchEvent(new Event("ces-messenger-loaded"));
    });

    expect(setQueryParametersMock).toHaveBeenCalledWith({
      snowplow_session_id: "session-abc",
    });
  });

  it("leaves the session-context variable unset for a cookieless/new visitor", async () => {
    getDomainSessionIdMock.mockReturnValue(undefined);
    root = createRoot(container);

    await act(async () => {
      root?.render(<CesMessengerWidget />);
    });

    const element = queryWidget(container);
    const setQueryParametersMock = vi.fn();
    element!.setQueryParameters = setQueryParametersMock;

    await act(async () => {
      window.dispatchEvent(new Event("ces-messenger-loaded"));
    });

    expect(setQueryParametersMock).not.toHaveBeenCalled();
  });

  it("renders nothing when NEXT_PUBLIC_CES_DEPLOYMENT_ID is not set", async () => {
    vi.stubEnv("NEXT_PUBLIC_CES_DEPLOYMENT_ID", "");
    root = createRoot(container);

    await act(async () => {
      root?.render(<CesMessengerWidget />);
    });

    expect(queryWidget(container)).toBeNull();
  });

  // Must run last in this file: customElements.define is irreversible in the
  // shared jsdom window, and the earlier tests rely on the element NOT having
  // setQueryParameters at mount (to exercise the event-listener path).
  it("passes the session id immediately when the widget loaded before mount", async () => {
    getDomainSessionIdMock.mockReturnValue("session-early");
    const instanceMock = vi.fn();
    customElements.define(
      "ces-messenger",
      class extends HTMLElement {
        setQueryParameters = instanceMock;
      }
    );
    root = createRoot(container);

    await act(async () => {
      root?.render(<CesMessengerWidget />);
    });

    expect(instanceMock).toHaveBeenCalledWith({
      snowplow_session_id: "session-early",
    });
  });
});
