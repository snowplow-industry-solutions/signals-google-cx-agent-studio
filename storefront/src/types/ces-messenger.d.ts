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
