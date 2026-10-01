import {
  createCart,
  createCheckout,
  createProduct,
  type Action,
  type CartUpdated,
  type CartViewed,
  type CheckoutCompleted,
  type CheckoutStarted,
  type CheckoutStepViewed,
  type ProductListClicked,
  type ProductListViewed,
  type ProductViewed,
} from "../../snowtype/snowplow";
import type { CartLineItem, Product as CommerceProduct } from "@/types/commerce";

const DEFAULT_CURRENCY = "USD";

type ProductContext = ReturnType<typeof createProduct>;
type CartContext = ReturnType<typeof createCart>;
type CheckoutContext = ReturnType<typeof createCheckout>;

function getCartEntries(cartLines: CartLineItem[], products: CommerceProduct[]) {
  return cartLines
    .map((line) => ({
      line,
      product: products.find((product) => product.id === line.productId),
    }))
    .filter(
      (
        entry
      ): entry is {
        line: CartLineItem;
        product: CommerceProduct;
      } => Boolean(entry.product)
    );
}

function getCartValue(cartLines: CartLineItem[], products: CommerceProduct[]) {
  return getCartEntries(cartLines, products).reduce(
    (sum, entry) => sum + entry.product.price * entry.line.quantity,
    0
  );
}

function createProductContext(product: CommerceProduct): ProductContext {
  return createProduct({
    product_id: product.id,
    sku: product.sku,
    product_name: product.name,
    designer: product.designer,
    category: product.category,
    color_family: product.colorFamily,
    occasion: product.occasion,
    price: product.price,
    currency: product.currency,
  });
}

function createProductContexts(products: CommerceProduct[]): ProductContext[] {
  return products.map(createProductContext);
}

function createCartContext(
  cartLines: CartLineItem[],
  products: CommerceProduct[]
): CartContext {
  return createCart({
    cart_line_count: cartLines.length,
    cart_value: getCartValue(cartLines, products),
    currency: DEFAULT_CURRENCY,
  });
}

function createCheckoutContext(
  step: string,
  cartLines: CartLineItem[],
  products: CommerceProduct[]
): CheckoutContext {
  return createCheckout({
    checkout_step: step,
    item_count: cartLines.reduce((sum, line) => sum + line.quantity, 0),
    order_value: getCartValue(cartLines, products),
    currency: DEFAULT_CURRENCY,
  });
}

export function getCartValueBand(total: number) {
  if (total >= 2000) {
    return "luxury";
  }
  if (total >= 800) {
    return "considered";
  }

  return "entry";
}

export function createProductListViewedTrackingProps(
  listId: string,
  listName: string,
  listType: string,
  items: CommerceProduct[]
): ProductListViewed & { context: ProductContext[] } {
  return {
    list_id: listId,
    list_name: listName,
    list_type: listType,
    product_count: items.length,
    context: createProductContexts(items),
  };
}

export function createProductListTrackingFingerprint(
  pathname: string,
  listId: string,
  items: CommerceProduct[]
) {
  return [pathname, listId, ...items.map((item) => item.id)].join("::");
}

export function createProductListClickedTrackingProps(
  listId: string,
  listName: string,
  product: CommerceProduct
): ProductListClicked & { context: ProductContext[] } {
  return {
    list_id: listId,
    list_name: listName,
    product_id: product.id,
    context: [createProductContext(product)],
  };
}

export function createProductViewedTrackingProps(
  product: CommerceProduct
): ProductViewed & { context: ProductContext[] } {
  return {
    product_id: product.id,
    product_name: product.name,
    context: [createProductContext(product)],
  };
}

export function createCartUpdatedTrackingProps(
  action: Action,
  product: CommerceProduct,
  quantity: number,
  cartLines: CartLineItem[],
  products: CommerceProduct[]
): CartUpdated & { context: [ProductContext, CartContext] } {
  return {
    action,
    product_id: product.id,
    quantity,
    cart_line_count: cartLines.length,
    context: [
      createProductContext(product),
      createCartContext(cartLines, products),
    ],
  };
}

export function createCartViewedTrackingProps(
  cartLines: CartLineItem[],
  products: CommerceProduct[]
): CartViewed & { context: Array<CartContext | ProductContext> } {
  const entries = getCartEntries(cartLines, products);
  const cartValue = getCartValue(cartLines, products);

  return {
    cart_line_count: cartLines.length,
    cart_value: cartValue,
    currency: DEFAULT_CURRENCY,
    cart_value_band: getCartValueBand(cartValue),
    context: [
      createCartContext(cartLines, products),
      ...entries.map((entry) => createProductContext(entry.product)),
    ],
  };
}

export function createCheckoutStepTrackingProps(
  step: string,
  cartLines: CartLineItem[],
  products: CommerceProduct[]
):
  | {
      kind: "started";
      props: CheckoutStarted & {
        context: Array<CheckoutContext | ProductContext>;
      };
    }
  | {
      kind: "stepViewed";
      props: CheckoutStepViewed & {
        context: Array<CheckoutContext | ProductContext>;
      };
    } {
  const productContexts = getCartEntries(cartLines, products).map((entry) =>
    createProductContext(entry.product)
  );
  const props = {
    checkout_step: step,
    cart_line_count: cartLines.length,
    context: [createCheckoutContext(step, cartLines, products), ...productContexts],
  };

  return step === "shipping"
    ? { kind: "started", props }
    : { kind: "stepViewed", props };
}

export function createCheckoutCompletedTrackingProps(
  cartLines: CartLineItem[],
  products: CommerceProduct[]
): CheckoutCompleted & { context: Array<CheckoutContext | ProductContext> } {
  const entries = getCartEntries(cartLines, products);

  return {
    order_value: getCartValue(cartLines, products),
    currency: DEFAULT_CURRENCY,
    item_count: cartLines.length,
    context: [
      createCheckoutContext("review", cartLines, products),
      ...entries.map((entry) => createProductContext(entry.product)),
    ],
  };
}
