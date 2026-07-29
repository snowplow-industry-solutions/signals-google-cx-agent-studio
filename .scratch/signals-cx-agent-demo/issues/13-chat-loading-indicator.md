# 13 — Chat loading indicator while agent responds

Status: ready-for-agent

## Parent

`.scratch/signals-cx-agent-demo/PRD.md`

## What to build

After a shopper sends a chat message there is no visual feedback until the
agent's reply lands — the user can't tell whether the agent is working,
stuck, or crashed. Dead air also looks broken on the demo recording.

Upstream `ces-messenger` ships **no built-in typing/loading indicator** and
no config for one (checked against `GoogleCloudPlatform/ces-messenger` docs
2026-07-29). It does emit the events needed to build one client-side, on the
same extension surface issue 09's renderer already uses — storefront only,
zero agent/console changes:

- Send side: `ces-user-input-entered`, `ces-text-sent`, `ces-message-sent`
- Receive side: `ces-message-received`, `ces-text-received`,
  `ces-payload-received`
- Failure signals: `ces-messenger-disconnected`, `ces-authentication-error`

(Event names doc-derived, same unversioned-gstatic-script caveat as the
renderer — verify live at build, wire defensively.)

Behaviour: on a send event, inject a "typing dots" bubble at the end of the
shadow-DOM message list; remove it on the first receive event (text, payload,
or widget card). After ~30 s with no reply, swap to a subtle "still working"
cue rather than removing (covers the stuck/crashed perception); clear on
disconnect/auth-error. Follow the issue 09 renderer discipline: inline
styles with the luxury palette via CSS custom properties + hex fallbacks
(page styles don't cascade into the shadow root), injected node marked with
a data attribute and idempotent under mutation ticks (must not fight the
renderer's MutationObserver or the partial-token visibility machinery), all
component APIs/events wired defensively, teardown on unmount.

Timeline: polish — skip without ceremony if the 7 August recording is at
risk.

## Acceptance criteria

- [ ] Indicator appears promptly after the shopper sends a message
- [ ] Removed on the first agent output of any kind (text bubble, widget
      cards, rich payload)
- [ ] ~30 s timeout swaps to a "still working" cue; a late reply still
      clears it
- [ ] Cleared on `ces-messenger-disconnected` / `ces-authentication-error`
- [ ] Coexists with the widget renderer: no interference with token
      replacement, partial-token hiding, or template rendering (idempotence
      under repeated mutation ticks covered by tests)
- [ ] Styled to the storefront's dark luxury palette
- [ ] jsdom unit tests: show on send, remove on receive, timeout state,
      teardown on unmount
- [ ] Zero agent/console changes

## Blocked by

- `09-product-cards-stretch.md` (same code surface —
  `storefront/src/components/Widget/` — building before 09's branch merges
  invites conflicts)

## Comments

**2026-07-29 (human/assistant):** Raised from local testing of issue 09's
renderer. Upstream component confirmed to lack any native indicator;
event surface confirmed sufficient for a client-side one.
