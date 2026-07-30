"""Recon 2: open the chat panel and map its expanded shadow DOM."""

from playwright.sync_api import sync_playwright

BASE = "https://signals-google-gecx-storefront.vercel.app"
OUT = os.environ.get(
    "VERIFY_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
)
os.makedirs(OUT, exist_ok=True)

TREE_JS = """
() => {
  const el = document.querySelector('ces-messenger');
  const sr = el && el.shadowRoot;
  if (!sr) return {ok: false};
  const lines = [];
  const walk = (root, prefix) => {
    for (const node of root.querySelectorAll('*')) {
      const tag = node.tagName.toLowerCase();
      if (tag === 'style' || tag === 'script') continue;
      const id = node.id ? '#' + node.id : '';
      const cls = (typeof node.className === 'string' && node.className.trim())
        ? '.' + node.className.trim().split(/\\s+/).slice(0, 4).join('.') : '';
      const aria = node.getAttribute('aria-label');
      const ph = node.getAttribute('placeholder');
      const extra = [];
      if (aria) extra.push('aria=' + aria);
      if (ph) extra.push('placeholder=' + ph);
      if (node.getAttribute('contenteditable')) extra.push('contenteditable');
      lines.push(prefix + tag + id + cls + (extra.length ? ' [' + extra.join(' | ') + ']' : ''));
      if (node.shadowRoot) {
        lines.push(prefix + '  >>SHADOW ' + tag);
        walk(node.shadowRoot, prefix + '    ');
      }
    }
  };
  walk(sr, '');
  return {ok: true, lines};
}
"""

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, channel="chrome")
    page = browser.new_page(viewport={"width": 1400, "height": 1000})
    page.goto(BASE, wait_until="networkidle", timeout=60000)
    page.wait_for_timeout(5000)

    launcher = page.locator("ces-messenger div.assistant-collapsed")
    launcher.click()
    page.wait_for_timeout(4000)

    tree = page.evaluate(TREE_JS)
    for line in tree.get("lines", []):
        print(line)
    page.screenshot(path=f"{OUT}/recon-chat-open.png")
    browser.close()
