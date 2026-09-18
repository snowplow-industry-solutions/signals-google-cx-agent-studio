// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getDomainSessionIdMock, getDomainUserIdMock } = vi.hoisted(() => ({
  getDomainSessionIdMock: vi.fn(),
  getDomainUserIdMock: vi.fn(),
}));

vi.mock("@snowplow/browser-tracker", () => ({
  getDomainSessionId: getDomainSessionIdMock,
}));

vi.mock("@/utils/getDomainUserId", () => ({
  getDomainUserId: getDomainUserIdMock,
}));

vi.mock("next/script", () => ({
  default: () => null,
}));

// useWidgetTokenRenderer calls next/navigation's useRouter, which requires a
// mounted app router; these tests render the component bare.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import type { CesMessengerElement } from "@/types/ces-messenger";
import { CesMessengerWidget, setSnowplowTurnId } from "@/components/Widget/CesMessengerWidget";

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

  it("passes domain_userid to setQueryParameters once the widget loads", async () => {
    getDomainUserIdMock.mockReturnValue("user-abc");
    root = createRoot(container);

    await act(async () => {
      root?.render(<CesMessengerWidget />);
    });

    const element = queryWidget(container);
    expect(element).not.toBeNull();

    const setQueryParametersMock = vi.fn();
    element!.setQueryParameters = setQueryParametersMock;

    await act(async () => {
      window.dispatchEvent(new Event("ces-messenger-loaded"));
    });

    expect(setQueryParametersMock).toHaveBeenCalledWith({
      snowplow_user_id: "user-abc",
    });
  });

  it("leaves the user-id variable unset when the tracker has no domain user id", async () => {
    getDomainSessionIdMock.mockReturnValue("session-abc");
    getDomainUserIdMock.mockReturnValue(undefined);
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

    expect(setQueryParametersMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ snowplow_user_id: expect.anything() })
    );
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

describe("setSnowplowTurnId", () => {
  it("sets snowplow_turn_id on the given element", () => {
    const setQueryParametersMock = vi.fn();
    const element = { setQueryParameters: setQueryParametersMock } as unknown as CesMessengerElement;

    setSnowplowTurnId(element, "turn-1");

    expect(setQueryParametersMock).toHaveBeenCalledWith({
      snowplow_turn_id: "turn-1",
    });
  });
});
