import { chromium } from "playwright";
import fs from "node:fs";

const SOURCE_URL = "https://www.betus.com.pa/promotions/";
const OUT_PATH = "data/promos.json";

function clean(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

(async () => {
  const browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext({
    locale: "en-US",
    timezoneId: "America/New_York",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1365, height: 768 }
  });

  const page = await context.newPage();

  // Reduce background noise that can keep the network “busy”
  await page.route("**/*", (route) => {
    const url = route.request().url();
    const type = route.request().resourceType();

    // Block common analytics/ad/tracker resources (safe for content scraping)
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

  // IMPORTANT: do NOT use networkidle
  await page.goto(SOURCE_URL, { waitUntil: "domcontentloaded", timeout: 120000 });

  // Wait for promo content signal
  // If BetUS changes wording later, adjust this to a stable selector or different keyword.
  await page.waitForSelector("text=/Promocode\\s*:?/i", { timeout: 90000 });

  // Give the page a moment to render all cards (common on promo grids)
  await page.waitForTimeout(2500);

  const promos = await page.evaluate(() => {
    const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
    const knownTags = new Set(["SIGN-UP", "SPORTSBOOK", "CASINO", "CRYPTO", "RE-UP"]);

    // Find any element containing “Promocode”, then climb to a card container
    const codeNodes = Array.from(document.querySelectorAll("*")).filter(
      (el) => el.childElementCount === 0 && /Promocode\s*:?/i.test(el.textContent || "")
    );

    const candidates = [];
    const seen = new Set();

    for (const node of codeNodes) {
      let card = node.closest("article, section, div");
      for (let i = 0; i < 7 && card && card.parentElement; i++) {
        const lines = (card.innerText || "").split("\n").map(clean).filter(Boolean);
        if (lines.length >= 4) break;
        card = card.parentElement;
      }
      if (!card) continue;

      const text = (card.innerText || "").trim();
      if (!text || text.length < 60) continue;

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

      const promoLine = lines.find((l) => /^Promocode\b/i.test(l)) || "";
      const codeMatch = promoLine.match(/Promocode\s*:?\s*([A-Z0-9]+)/i);
      const promocode = codeMatch ? codeMatch[1].toUpperCase() : "";

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
        .filter((l) => l.length >= 3);

      if (!title || !promocode) continue;

      promos.push({
        title,
        tags: Array.from(new Set(tags)),
        bullets,
        promocode
      });
    }

    // De-dupe by promocode
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
    throw new Error("Extracted 0 promos. The page likely changed structure or is blocking automation.");
  }
})();

