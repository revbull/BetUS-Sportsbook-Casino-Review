import { chromium } from "playwright";
import fs from "node:fs";

const SOURCE_URL = "https://www.betus.com.pa/promotions/";
const OUT_PATH = "data/promos.json";

function clean(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function parseCardText(raw) {
  // Convert the card block into normalized lines
  const lines = raw
    .split("\n")
    .map(clean)
    .filter(Boolean);

  // Find the "Promocode XXXX" line and code
  const promoLine = lines.find((l) => /^Promocode\b/i.test(l)) || "";
  const m = promoLine.match(/Promocode\s*:?\s*([A-Z0-9]+)/i);
  const promocode = m ? m[1].toUpperCase() : "";

  // Known tags on the site
  const knownTags = new Set(["SIGN-UP", "SPORTSBOOK", "CASINO", "CRYPTO", "RE-UP"]);
  const tags = lines
    .filter((l) => knownTags.has(l.toUpperCase()))
    .map((l) => l.toUpperCase());

  // Title: first non-tag line after tags that isn't "Promocode" and isn't a button label
  const title =
    lines.find(
      (l) =>
        l.length >= 6 &&
        !knownTags.has(l.toUpperCase()) &&
        !/^Promocode\b/i.test(l) &&
        !/^(Join Now|Bonus Details)/i.test(l) &&
        !/^Filter by:/i.test(l)
    ) || "";

  // Bullets: grab lines between title and promo line, excluding tags and UI labels
  const titleIdx = lines.indexOf(title);
  const promoIdx = lines.findIndex((l) => /^Promocode\b/i.test(l));

  const bullets = lines
    .slice(titleIdx + 1, promoIdx >= 0 ? promoIdx : undefined)
    .filter((l) => !knownTags.has(l.toUpperCase()))
    .filter((l) => !/^(Join Now|Bonus Details)/i.test(l))
    .filter((l) => l.length >= 3);

  if (!title || !promocode) return null;

  return { title, tags: Array.from(new Set(tags)), bullets, promocode };
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

  // DO NOT block resources while we are debugging; we want the real page.
  await page.goto(SOURCE_URL, { waitUntil: "domcontentloaded", timeout: 120000 });

  // Try to wait for something meaningful; if it doesn't appear we will still capture debug
  try {
    await page.waitForSelector("text=/Latest Bonuses and Promotions/i", { timeout: 45000 });
  } catch {}

  // Give the page time to render promo tiles if they load after DOMContentLoaded
  await page.waitForTimeout(3500);

  // Extract: find *any* element containing “Promocode” and climb to the closest card-like container.
  const promos = await page.evaluate(() => {
    const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

    // Find all elements with "Promocode" anywhere in textContent.
    const promoEls = Array.from(document.querySelectorAll("*"))
      .filter((el) => /Promocode\s*/i.test(el.textContent || ""));

    const seen = new Set();
    const blocks = [];

    for (const el of promoEls) {
      // climb to a container likely holding a whole promo tile
      let card = el.closest("article, li, section, div");
      for (let i = 0; i < 7 && card && card.parentElement; i++) {
        const t = clean(card.innerText || "");
        // A promo tile tends to have several lines + includes Promocode
        if (t.includes("Promocode") && t.length > 120) break;
        card = card.parentElement;
      }
      if (!card) continue;

      const text = clean(card.innerText || "");
      if (!text.includes("Promocode")) continue;
      if (text.length < 120 || text.length > 4000) continue;

      if (seen.has(text)) continue;
      seen.add(text);
      blocks.push(text);
    }

    return blocks;
  });

  // Parse the text blocks into structured promos
  const parsed = [];
  for (const raw of promos) {
    // Recreate rough line breaks for better parsing
    const normalized = raw
      .replace(/Promocode\s*:?\s*/gi, "\nPromocode ")
      .replace(/\s+COPIED!/gi, " COPIED!")
      .replace(/\s+Bonus Details\s*>/gi, "\nBonus Details >")
      .replace(/\s+Join Now/gi, "\nJoin Now");

    const p = parseCardText(normalized);
    if (p) parsed.push(p);
  }

  // De-dupe by code
  const byCode = new Map();
  for (const p of parsed) byCode.set(p.promocode, p);

  const finalPromos = Array.from(byCode.values());

  // Always write output (even empty) so the workflow can commit/debug
  const payload = {
    lastUpdatedUtc: new Date().toISOString(),
    source: SOURCE_URL,
    promos: finalPromos
  };

  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2), "utf8");

  console.log(`Saved ${finalPromos.length} promos to ${OUT_PATH}`);

  // If empty, write debug artifacts so we can see what Actions received
  if (finalPromos.length === 0) {
    fs.mkdirSync("debug", { recursive: true });
    fs.writeFileSync("debug/page-title.txt", await page.title(), "utf8");
    fs.writeFileSync("debug/page-url.txt", page.url(), "utf8");
    fs.writeFileSync("debug/page.html", await page.content(), "utf8");
    await page.screenshot({ path: "debug/page.png", fullPage: true });

    await browser.close();

    throw new Error(
      "Extracted 0 promos. Debug artifacts saved to /debug (page.html + screenshot)."
    );
  }

  await browser.close();
})();
