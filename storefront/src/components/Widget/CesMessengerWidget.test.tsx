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

  /**
   * Renders the widget, swaps in a setQueryParameters mock, and fires the
   * window-level loaded event the real widget dispatches. Returns the element
   * and the mock so tests can go on to call setSnowplowTurnId against them.
   */
  async function renderAndLoad() {
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

    return { element: element!, setQueryParametersMock };
  }

  // setQueryParameters replaces the whole variable set on every call, so the
  // session and user ids must travel together; two one-key calls would leave
  // the agent with only whichever was set last (the bug behind this file).
  it("passes domain_sessionid and domain_userid together in a single setQueryParameters call once the widget loads", async () => {
    getDomainSessionIdMock.mockReturnValue("session-abc");
    getDomainUserIdMock.mockReturnValue("user-abc");

    const { setQueryParametersMock } = await renderAndLoad();

    expect(setQueryParametersMock).toHaveBeenCalledTimes(1);
    expect(setQueryParametersMock).toHaveBeenCalledWith({
      snowplow_session_id: "session-abc",
      snowplow_user_id: "user-abc",
    });
  });

  it("passes only the session id when the tracker has no domain user id", async () => {
    getDomainSessionIdMock.mockReturnValue("session-abc");
    getDomainUserIdMock.mockReturnValue(undefined);

    const { setQueryParametersMock } = await renderAndLoad();

    expect(setQueryParametersMock).toHaveBeenCalledTimes(1);
    expect(setQueryParametersMock).toHaveBeenCalledWith({
      snowplow_session_id: "session-abc",
    });
  });

  it("passes only the user id when the tracker has no domain session id", async () => {
    getDomainSessionIdMock.mockReturnValue(undefined);
    getDomainUserIdMock.mockReturnValue("user-abc");

    const { setQueryParametersMock } = await renderAndLoad();

    expect(setQueryParametersMock).toHaveBeenCalledTimes(1);
    expect(setQueryParametersMock).toHaveBeenCalledWith({
      snowplow_user_id: "user-abc",
    });
  });

  it("does not call setQueryParameters for a cookieless/new visitor with neither id", async () => {
    getDomainSessionIdMock.mockReturnValue(undefined);
    getDomainUserIdMock.mockReturnValue(undefined);

    const { setQueryParametersMock } = await renderAndLoad();

    expect(setQueryParametersMock).not.toHaveBeenCalled();
  });

  it("resends the session and user ids alongside snowplow_turn_id so a send does not wipe them", async () => {
    getDomainSessionIdMock.mockReturnValue("session-abc");
    getDomainUserIdMock.mockReturnValue("user-abc");

    const { element, setQueryParametersMock } = await renderAndLoad();
    setQueryParametersMock.mockClear();

    setSnowplowTurnId(element, "turn-1");

    expect(setQueryParametersMock).toHaveBeenCalledTimes(1);
    expect(setQueryParametersMock).toHaveBeenLastCalledWith({
      snowplow_session_id: "session-abc",
      snowplow_user_id: "user-abc",
      snowplow_turn_id: "turn-1",
    });

    setSnowplowTurnId(element, "turn-2");

    expect(setQueryParametersMock).toHaveBeenLastCalledWith({
      snowplow_session_id: "session-abc",
      snowplow_user_id: "user-abc",
      snowplow_turn_id: "turn-2",
    });
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
  it("passes both ids immediately when the widget loaded before mount", async () => {
    getDomainSessionIdMock.mockReturnValue("session-early");
    getDomainUserIdMock.mockReturnValue("user-early");
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

    expect(instanceMock).toHaveBeenCalledTimes(1);
    expect(instanceMock).toHaveBeenCalledWith({
      snowplow_session_id: "session-early",
      snowplow_user_id: "user-early",
    });
  });
});

describe("setSnowplowTurnId", () => {
  it("sets only snowplow_turn_id on an element the widget never loaded ids for", () => {
    const setQueryParametersMock = vi.fn();
    const element = { setQueryParameters: setQueryParametersMock } as unknown as CesMessengerElement;

    setSnowplowTurnId(element, "turn-1");

    expect(setQueryParametersMock).toHaveBeenCalledWith({
      snowplow_turn_id: "turn-1",
    });
  });
});
