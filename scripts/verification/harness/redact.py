"""Token redaction for anything a verification script writes to disk.

Lives in the shared package, not in one entry script, because every script here
serialises captured console output and the CES token broker's `chatToken` turns
up in a console debug line on every run that opens the chat. `verify_widgets.py`
owning the only copy of this meant `commentary.py` and `walkthrough.py` wrote
the token verbatim.

Reports go to a gitignored directory, but a report can still end up shared or
attached somewhere outside the repo, so "gitignored" is not the control that
matters.

Shape of the real captured line, which is what the value class has to cover:

    Token received from token broker: {chatToken: <~50 chars>…<~49 chars>,
                                       expireTime: 2024-01-15T12:02:50.687240Z}

The storefront truncates the token with a **Unicode ellipsis** before logging
it. A value class of `[\\w\\-\\.]` stops dead at that `…` and leaves the tail
behind, which is how a partial token survived the first redaction pass. `…` is
therefore part of the value class, as are `+ / =` for standard base64 and an
optional `Bearer ` prefix.

What must NOT be redacted: `[Signals Demo] Passed domain_sessionid to widget
{sessionId: …}`. `collector.Recorder.forwarded_id()` parses that line to find
the session to poll Signals for, so over-redaction breaks session detection.
`sessionId` is deliberately absent from the key list, and `selfcheck.REDACT_CASES`
holds it as a standing negative case.
"""

import re

# Key list is narrow on purpose (see the module docstring). The value class is
# wide: anything that looks like 16+ characters of token material after one of
# those keys goes.
#
# The optional `<redacted>` before the value class makes a second pass heal a
# report written by the pre-fix redactor, where the head was replaced but the
# `…<tail>` survived. Re-running redact() over a fully redacted line is still a
# no-op -- `redacted` is 8 characters, short of the 16 minimum.
TOKEN_PATTERN = re.compile(
    r'''(["']?(?:chatToken|token|access_token|authorization)["']?\s*[:=]\s*)'''
    r'''(?:Bearer\s+)?(?:<redacted>)?["']?[\w\-\.…+/=]{16,}["']?''',
    re.IGNORECASE,
)

REDACTION = "<redacted>"


def redact_line(text):
    """Redact token-shaped values in one string. Idempotent."""
    if not text:
        return text
    return TOKEN_PATTERN.sub(r"\1" + REDACTION, text)


def redact(lines):
    """Redact a list of console line strings."""
    return [redact_line(line) for line in lines]


def redact_console(entries):
    """Redact `RendererLog.console` entries -- (timestamp, type, text) triples.

    Returns lists rather than tuples because the only caller is `json.dump`,
    which would emit lists anyway.
    """
    return [[t, typ, redact_line(text)] for t, typ, text in entries]
