import { chromium } from "playwright";
import fs from "node:fs";

const SOURCE_URL = "https://www.betus.com.pa/promotions/";
const OUT_PATH = "data/promos.json";

function clean(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  const context = await browser.newContext({
    locale: "en-US",
    timezoneId: "America/New_York",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1365, height: 768 }
  });

  const page = await context.newPage();

  // Reduce background noise that can keep the page “busy”
  await page.route("**/*", (route) => {
    const url = route.request().url();
    const type = route.request().resourceType();

    if (
      type === "font" ||
      url.includes("googletagmanager") ||
      url.includes("google-analytics") ||
      url.includes("doubleclick") ||
      url.includes("facebook") ||
      url.includes("hotjar")
    ) {
      return route.abort();
    }
    return route.continue();
  });

  // IMPORTANT: do NOT use networkidle on promo pages
  await page.goto(SOURCE_URL, { waitUntil: "domcontentloaded", timeout: 120000 });

  // Wait until we see “Promocode” somewhere on the page
  await page.waitForSelector("text=/Promocode\\s*/i", { timeout: 90000 });

  // Allow rendering to settle
  await page.waitForTimeout(2500);

  const promos = await page.evaluate(() => {
    const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
    const knownTags = new Set(["SIGN-UP", "SPORTSBOOK", "CASINO", "CRYPTO", "RE-UP"]);

    // IMPORTANT: do NOT require leaf nodes
    const nodes = Array.from(document.querySelectorAll("*")).filter((el) =>
      /Promocode\s*/i.test(el.textContent || "")
    );

    const candidates = [];
    const seen = new Set();

    function looksLikePromoCard(text) {
      const t = text.toLowerCase();
      // Heuristics typical for BetUS promo tiles
      return (
        t.includes("promocode") &&
        (t.includes("join now") || t.includes("bonus details")) &&
        text.length >= 120 &&
        text.length <= 2500
      );
    }

    for (const el of nodes) {
      let card = el.closest("article, li, section") || el.closest("div");

      for (let i = 0; i < 6 && card && card.parentElement; i++) {
        const text = clean(card.innerText || "");
        if (looksLikePromoCard(text)) break;
        card = card.parentElement;
      }

      if (!card) continue;

      const text = clean(card.innerText || "");
      if (!looksLikePromoCard(text)) continue;

      if (seen.has(text)) continue;
      seen.add(text);
      candidates.push(text);
    }

    const promos = [];

    for (const raw of candidates) {
      const lines = raw
        .split("\n")
        .map(clean)
        .filter(Boolean);

      const tags = lines
        .filter((l) => knownTags.has(l.toUpperCase()))
        .map((l) => l.toUpperCase());

      // BetUS format: "Promocode JOIN125 COPIED!"
      const promoLine = lines.find((l) => /^Promocode\b/i.test(l)) || "";
      const codeMatch = promoLine.match(/Promocode\s*:?\s*([A-Z0-9]+)/i);
      const promocode = codeMatch ? codeMatch[1].toUpperCase() : "";

      // Title: first meaningful line that is not a tag or Promocode line
      const title =
        lines.find(
          (l) =>
            l.length >= 6 &&
            !knownTags.has(l.toUpperCase()) &&
            !/^Promocode\b/i.test(l)
        ) || "";

      const titleIdx = lines.indexOf(title);
      const promoIdx = lines.findIndex((l) => /^Promocode\b/i.test(l));

      const bullets = lines
        .slice(titleIdx + 1, promoIdx >= 0 ? promoIdx : undefined)
        .filter((l) => !knownTags.has(l.toUpperCase()))
        .filter((l) => !/^(Join Now|Bonus Details)/i.test(l))
        .filter((l) => l.length >= 3);

      if (!title || !promocode) continue;

      promos.push({
        title,
        tags: Array.from(new Set(tags)),
        bullets,
        promocode
      });
    }

    // De-dupe by code
    const byCode = new Map();
    for (const p of promos) byCode.set(p.promocode, p);
    return Array.from(byCode.values());
  });

  await browser.close();

  const payload = {
    lastUpdatedUtc: new Date().toISOString(),
    source: SOURCE_URL,
    promos
  };

  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2), "utf8");

  console.log(`Saved ${promos.length} promos to ${OUT_PATH}`);

  if (promos.length === 0) {
    throw new Error(
      "Extracted 0 promos. The page structure may have changed or automation is being blocked."
    );
  }
})();
