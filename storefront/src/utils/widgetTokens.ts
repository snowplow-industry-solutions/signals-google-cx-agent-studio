/**
 * Parser for CX Agent Studio rich-response-widget invocations.
 *
 * The runSession API delivers widget calls in-band inside the message text:
 * `{@Widget: name(payload: {…}, summary: "…")}`.
 * The pinned open-source ces-messenger has no renderer for these tokens, so
 * the storefront extracts them from rendered chat text and draws its own
 * cards (issue 09). The argument list is written in JS-object-literal style
 * (bare keys, double-quoted strings), NOT strict JSON, and the model
 * appends arguments that aren't in the widget schema (e.g. `summary:`) —
 * the parser must tolerate both.
 */

export interface WidgetToken {
  /** Widget tool name, e.g. "productCarousel" or "productDetails". */
  name: string;
  /** Parsed `payload:` argument; null when the payload can't be parsed. */
  payload: unknown;
  /** Index of the opening `{` of `{@Widget:` in the source text. */
  start: number;
  /** Index just past the closing `}` of `)}`. */
  end: number;
}

const TOKEN_MARKER = "{@Widget:";

/**
 * Walks a JS-object-literal argument string and rewrites it as strict JSON:
 * quotes bare keys, converts single-quoted strings, and drops trailing
 * commas. Character-by-character with in-string tracking, so colons and
 * braces inside string values (URLs, prose) are never touched.
 */
function jsObjectLiteralToJson(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const ch = src[i];

    if (ch === '"' || ch === "'") {
      // Copy the whole string literal, normalising to double quotes.
      const quote = ch;
      let body = "";
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\") {
          body += src[i] + (src[i + 1] ?? "");
          i += 2;
          continue;
        }
        body += src[i];
        i++;
      }
      i++; // closing quote
      out += '"' + body.replace(/"/g, '\\"') + '"';
      continue;
    }

    if (/[A-Za-z_$]/.test(ch)) {
      let ident = "";
      while (i < src.length && /[\w$]/.test(src[i])) {
        ident += src[i];
        i++;
      }
      let j = i;
      while (j < src.length && /\s/.test(src[j])) j++;
      if (src[j] === ":") {
        out += '"' + ident + '"'; // bare key
      } else if (ident === "true" || ident === "false" || ident === "null") {
        out += ident;
      } else if (ident === "undefined") {
        out += "null";
      } else {
        out += '"' + ident + '"'; // bare word used as a value
      }
      continue;
    }

    if (ch === ",") {
      let j = i + 1;
      while (j < src.length && /\s/.test(src[j])) j++;
      if (src[j] === "}" || src[j] === "]" || j >= src.length) {
        i++; // trailing comma
        continue;
      }
    }

    out += ch;
    i++;
  }
  return out;
}

/**
 * Finds the index just past the `)` that closes the token's argument list,
 * or -1 if the token is still incomplete (e.g. mid-stream). `openParen` is
 * the index of the `(` after the widget name.
 */
function findArgsEnd(text: string, openParen: number): number {
  let depth = 0;
  let inString: string | null = null;
  for (let i = openParen; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") inString = ch;
    else if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * Extracts every complete widget token from a chat message. Incomplete
 * tokens (still streaming) are ignored; call again when more text arrives.
 * A token whose arguments can't be parsed is still returned (with
 * `payload: null`) so callers can strip the raw text rather than show the
 * shopper internal syntax.
 */
export function findWidgetTokens(text: string): WidgetToken[] {
  const tokens: WidgetToken[] = [];
  let from = 0;
  for (;;) {
    const start = text.indexOf(TOKEN_MARKER, from);
    if (start === -1) break;

    let i = start + TOKEN_MARKER.length;
    while (i < text.length && /\s/.test(text[i])) i++;
    let name = "";
    while (i < text.length && /[\w$]/.test(text[i])) {
      name += text[i];
      i++;
    }
    while (i < text.length && /\s/.test(text[i])) i++;
    if (!name || text[i] !== "(") {
      from = start + TOKEN_MARKER.length;
      continue;
    }

    const argsEnd = findArgsEnd(text, i);
    if (argsEnd === -1) break; // incomplete — wait for more text

    let end = argsEnd;
    while (end < text.length && /\s/.test(text[end])) end++;
    if (text[end] !== "}") {
      from = start + TOKEN_MARKER.length;
      continue;
    }
    end++;

    const argsSrc = text.slice(i + 1, argsEnd - 1);
    let payload: unknown = null;
    try {
      const parsed = JSON.parse("{" + jsObjectLiteralToJson(argsSrc) + "}");
      payload = (parsed as { payload?: unknown }).payload ?? null;
    } catch {
      payload = null;
    }

    tokens.push({ name, payload, start, end });
    from = end;
  }
  return tokens;
}

/**
 * Index where an incomplete trailing token begins, or -1. Lets a renderer
 * hide in-progress widget syntax while the response is still streaming.
 */
export function findPartialTokenStart(text: string): number {
  let from = 0;
  for (;;) {
    const start = text.indexOf(TOKEN_MARKER, from);
    if (start === -1) return -1;
    let i = start + TOKEN_MARKER.length;
    while (i < text.length && /\s/.test(text[i])) i++;
    while (i < text.length && /[\w$]/.test(text[i])) i++;
    while (i < text.length && /\s/.test(text[i])) i++;
    if (i >= text.length) return start; // marker + partial name only
    if (text[i] !== "(") {
      from = start + TOKEN_MARKER.length;
      continue;
    }
    const argsEnd = findArgsEnd(text, i);
    if (argsEnd === -1) return start;
    let end = argsEnd;
    while (end < text.length && /\s/.test(text[end])) end++;
    if (text[end] !== "}") {
      from = argsEnd;
      continue;
    }
    from = end + 1;
  }
}
