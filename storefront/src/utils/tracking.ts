"use client";

import { trackPageView } from "@snowplow/browser-tracker";
import { useEffect, useRef } from "react";

import {
  trackProductListViewedSpec,
  trackProductViewedSpec,
} from "@/snowtype/snowplow";
import type { Product } from "@/types/commerce";
import { logSignalsDemo } from "@/utils/demo";
import {
  createProductListTrackingFingerprint,
  createProductListViewedTrackingProps,
  createProductViewedTrackingProps,
} from "@/utils/snowtypeTracking";

export function trackDemoPageView(pathname: string) {
  try {
    trackPageView({ title: `Signals Demo ${pathname}` });
    logSignalsDemo("Tracked page view", pathname);
  } catch (error) {
    console.error("[Signals Demo] Page view tracking failed", error);
  }
}

export function trackDemoProductView(product: Product) {
  try {
    trackProductViewedSpec(createProductViewedTrackingProps(product));
    logSignalsDemo("Tracked product view", {
      productId: product.id,
      productName: product.name,
    });
  } catch (error) {
    console.error("[Signals Demo] Product view tracking failed", error);
  }
}

interface ProductListTrackingArgs {
  pathname: string;
  ready: boolean;
  listId: string;
  listName: string;
  listType: string;
  items: Product[];
}

export function useTrackDemoProductListView({
  pathname,
  ready,
  listId,
  listName,
  listType,
  items,
}: ProductListTrackingArgs) {
  const trackedFingerprints = useRef(new Set<string>());

  useEffect(() => {
    if (!ready || items.length === 0) {
      return;
    }

    const fingerprint = createProductListTrackingFingerprint(pathname, listId, items);
    if (trackedFingerprints.current.has(fingerprint)) {
      return;
    }

    try {
      trackProductListViewedSpec(
        createProductListViewedTrackingProps(listId, listName, listType, items)
      );
      trackedFingerprints.current.add(fingerprint);
      logSignalsDemo("Tracked product list view", {
        pathname,
        listId,
        listName,
        listType,
        productIds: items.map((item) => item.id),
      });
    } catch (error) {
      console.error("[Signals Demo] Product list view tracking failed", error);
    }
  }, [items, listId, listName, listType, pathname, ready]);
}
