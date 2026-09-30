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
import {
  CesMessengerWidget,
  sendIdentityVariables,
  setSnowplowTurnId,
} from "@/components/Widget/CesMessengerWidget";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  // The conversation hook arms the first turn's id at mount, before the
  // widget has loaded, so it must travel in the same call as the identity ids.
  it("passes domain_sessionid, domain_userid and the armed turn id together in a single setQueryParameters call once the widget loads", async () => {
    getDomainSessionIdMock.mockReturnValue("session-abc");
    getDomainUserIdMock.mockReturnValue("user-abc");

    const { setQueryParametersMock } = await renderAndLoad();

    expect(setQueryParametersMock).toHaveBeenCalledTimes(1);
    expect(setQueryParametersMock).toHaveBeenCalledWith({
      snowplow_session_id: "session-abc",
      snowplow_user_id: "user-abc",
      snowplow_turn_id: expect.stringMatching(UUID_RE),
    });
  });

  it("passes only the session id (plus the armed turn id) when the tracker has no domain user id", async () => {
    getDomainSessionIdMock.mockReturnValue("session-abc");
    getDomainUserIdMock.mockReturnValue(undefined);

    const { setQueryParametersMock } = await renderAndLoad();

    expect(setQueryParametersMock).toHaveBeenCalledTimes(1);
    expect(setQueryParametersMock).toHaveBeenCalledWith({
      snowplow_session_id: "session-abc",
      snowplow_turn_id: expect.stringMatching(UUID_RE),
    });
  });

  it("passes only the user id (plus the armed turn id) when the tracker has no domain session id", async () => {
    getDomainSessionIdMock.mockReturnValue(undefined);
    getDomainUserIdMock.mockReturnValue("user-abc");

    const { setQueryParametersMock } = await renderAndLoad();

    expect(setQueryParametersMock).toHaveBeenCalledTimes(1);
    expect(setQueryParametersMock).toHaveBeenCalledWith({
      snowplow_user_id: "user-abc",
      snowplow_turn_id: expect.stringMatching(UUID_RE),
    });
  });

  it("passes only the armed turn id for a cookieless/new visitor with neither identity id", async () => {
    getDomainSessionIdMock.mockReturnValue(undefined);
    getDomainUserIdMock.mockReturnValue(undefined);

    const { setQueryParametersMock } = await renderAndLoad();

    expect(setQueryParametersMock).toHaveBeenCalledTimes(1);
    expect(setQueryParametersMock).toHaveBeenCalledWith({
      snowplow_turn_id: expect.stringMatching(UUID_RE),
    });
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
  it("passes both ids immediately, together with the armed turn id, when the widget loaded before mount", async () => {
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

    // The hook's mount-time arm may push first; the identity send must then
    // carry everything, since setQueryParameters replaces the whole set.
    expect(instanceMock).toHaveBeenLastCalledWith({
      snowplow_session_id: "session-early",
      snowplow_user_id: "user-early",
      snowplow_turn_id: expect.stringMatching(UUID_RE),
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

  // The conversation hook arms the next turn id at mount, which can be before
  // the gstatic script has upgraded <ces-messenger> (no setQueryParameters
  // yet) and is always before handleLoaded sends the identity variables. The
  // pending id must survive both: no throw, and one combined call on load.
  it("holds a turn id set before the widget loaded and sends it together with the identity ids on load", async () => {
    getDomainSessionIdMock.mockReturnValue("session-abc");
    getDomainUserIdMock.mockReturnValue("user-abc");
    const element = document.createElement("ces-messenger") as unknown as CesMessengerElement;

    expect(() => setSnowplowTurnId(element, "turn-armed-early")).not.toThrow();

    const setQueryParametersMock = vi.fn();
    element.setQueryParameters = setQueryParametersMock;
    sendIdentityVariables(element);

    expect(setQueryParametersMock).toHaveBeenCalledTimes(1);
    expect(setQueryParametersMock).toHaveBeenCalledWith({
      snowplow_session_id: "session-abc",
      snowplow_user_id: "user-abc",
      snowplow_turn_id: "turn-armed-early",
    });
  });
});
