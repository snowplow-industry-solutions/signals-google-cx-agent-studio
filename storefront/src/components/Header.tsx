"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useCart } from "@/components/Cart/CartProvider";

const navigation = [
  { href: "/", label: "Home" },
  { href: "/collections/city-after-dark", label: "Evening" },
  { href: "/collections/winter-salon", label: "Winter" },
  { href: "/collections/accessory-atelier", label: "Accessories" },
];

export function Header() {
  const pathname = usePathname();
  const { itemCount } = useCart();

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[color:color-mix(in_srgb,var(--background)_88%,transparent)] backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5 lg:px-10">
        <Link href="/" className="space-y-1">
          <p className="text-[10px] uppercase tracking-[0.55em] text-[var(--muted)]">
            Snowplow Signals Demo
          </p>
          <p className="font-(--font-display) text-3xl text-foreground">
            Atelier Signals
          </p>
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {navigation.map((item) => {
            const active =
              item.href === "/"
                ? pathname === item.href
                : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`text-xs uppercase tracking-[0.28em] transition ${
                  active ? "text-foreground" : "text-[var(--muted)] hover:text-foreground"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-4 text-xs uppercase tracking-[0.24em]">
          <Link href="/checkout" className="text-[var(--muted)] hover:text-foreground">
            Checkout
          </Link>
          <Link
            href="/cart"
            className="rounded-full border border-white/15 px-4 py-2 text-foreground transition hover:border-[var(--accent)]"
          >
            Cart ({itemCount})
          </Link>
        </div>
      </div>
    </header>
  );
}
