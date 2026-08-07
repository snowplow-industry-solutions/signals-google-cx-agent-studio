/**
 * Type declarations for the ces-messenger web component (Google CES
 * Next-Gen chat widget, https://github.com/GoogleCloudPlatform/ces-messenger).
 * Not an npm package: loaded at runtime from the gstatic-hosted script, so
 * there are no upstream types to import.
 */
import type { DetailedHTMLProps, HTMLAttributes } from "react";

export interface CesMessengerElement extends HTMLElement {
  setQueryParameters(params: Record<string, string>): void;
  endSession?(): void;
  clearStorage?(args: { clearAuthentication?: boolean }): void;
  /** Rich-message template registration (doc/message_templates.md). The
   * function is a compiled Handlebars template — i.e. any
   * `(context) => htmlString` function. */
  registerTemplate?(templateId: string, template: (context: unknown) => string): void;
  /** Lifecycle hooks (README "Hooks"); `payload-received` receives the
   * (mutable) payload object and returns whether the default rich-message
   * action should run. */
  registerHook?(hook: string, callback: (payload: unknown) => boolean): void;
  /** Click handling for rendered rich-message templates. */
  registerRichMessageHandler?(
    templateId: string,
    handler: (
      message: { payload?: { context?: unknown } },
      clickedElement: Element
    ) => { action?: "delete" | "keep" } | undefined | void
  ): void;
}

type CesMessengerAttributes = HTMLAttributes<CesMessengerElement> & {
  "deployment-id": string;
  "chat-title"?: string;
  "token-broker-url"?: string;
  "theme-id"?: "light" | "dark";
  "auto-open-chat"?: boolean;
  "audio-input-mode"?: "DEFAULT_ON" | "DEFAULT_OFF" | "SPACE_BAR_TO_TALK" | "NONE";
  "audio-output-mode"?: "ALWAYS_ON" | "DEFAULT_ON" | "DEFAULT_OFF" | "DISABLED";
  "custom-css"?: string;
};

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "ces-messenger": DetailedHTMLProps<CesMessengerAttributes, CesMessengerElement>;
    }
  }
}
