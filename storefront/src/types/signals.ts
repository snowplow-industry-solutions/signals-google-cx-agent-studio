export type { Intervention } from "@snowplow/signals-browser-plugin";

export interface SignalsAttributes {
  domain_sessionid?: string;
  favorite_categories?: string[];
  favorite_category?: string;
  favorite_designers?: string[];
  favorite_designer?: string;
  favorite_color_family?: string;
  favorite_occasion?: string;
  recently_viewed_product_ids?: string[];
  high_intent_product_ids?: string[];
  category_interest_counts?: Record<string, number>;
  designer_interest_counts?: Record<string, number>;
  occasion_interest_counts?: Record<string, number>;
  color_family_interest_counts?: Record<string, number>;
  cart_value_band?: "entry" | "considered" | "luxury";
  has_active_cart?: boolean;
  checkout_stage?: "browsing" | "cart" | "shipping" | "payment" | "review";
  total_product_views?: number;
  total_add_to_cart?: number;
  total_checkout_steps?: number;
  price_affinity?: "refined" | "premium" | "collector";
  outerwear_interest_score?: number;
  tailoring_interest_score?: number;
  accessories_interest_score?: number;
  [key: string]:
    | string
    | number
    | boolean
    | string[]
    | number[]
    | Record<string, number>
    | null
    | undefined;
}

export interface SignalsBatchResponse {
  [identifier: string]: SignalsAttributes;
}
