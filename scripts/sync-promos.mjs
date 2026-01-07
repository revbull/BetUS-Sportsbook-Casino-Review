import { chromium } from "playwright";
import fs from "node:fs";

const SOURCE_URL = "https://www.betus.com.pa/promotions/";
const OUT_PATH = "data/promos.json";

function clean(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto(SOURCE_URL, { waitUntil: "networkidle", timeout: 120000 });

  // Attempt to find promo “cards” in a generic way.
  // This is robust to minor layout changes but may need adjustment if BetUS redesigns.
  const promos = await page.evaluate(() => {
    const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

    // Heuristic: locate repeating promo blocks by looking for elements containing "Promocode:"
    const codeNodes = Array.from(document.querySelectorAll("*"))
      .filter((el) => el.childElementCount === 0 && /Promocode\s*:?/i.test(el.textContent || ""));

    const uniqueCards = new Set();
    const cards = [];

    for (const node of codeNodes) {
      // walk up to a reasonable container
      let card = node.closest("article, section, div");
      for (let i = 0; i < 6 && card && card.parentElement; i++) {
        // prefer a container with multiple text lines
        if ((card.innerText || "").split("\n").length >= 4) break;
        card = card.parentElement;
      }
      if (!card) continue;

      const raw = clean(card.innerText || "");
      if (!raw || raw.length < 40) continue;

      if (uniqueCards.has(raw)) continue;
      uniqueCards.add(raw);

      // Extract title: first line that isn't a tag line
      const lines = (card.innerText || "").split("\n").map(clean).filter(Boolean);

      // tags often appear as short uppercase words; capture any that match known taxonomy
      const knownTags = new Set(["SIGN-UP", "SPORTSBOOK", "CASINO", "CRYPTO", "RE-UP"]);
      const tags = lines.filter((l) => knownTags.has(l.toUpperCase())).map((l) => l.toUpperCase());

      const title = lines.find((l) => l.length >= 6 && !knownTags.has(l.toUpperCase()) && !/^Promocode/i.test(l)) || "";

      // bullets: capture lines after title until "Promocode"
      const promoIdx = lines.findIndex((l) => /^Promocode/i.test(l));
      const titleIdx = lines.indexOf(title);

      const bullets = lines
        .slice(titleIdx + 1, promoIdx >= 0 ? promoIdx : undefined)
        .filter((l) => !knownTags.has(l.toUpperCase()))
        .filter((l) => l.length >= 3);

      const promoLine = promoIdx >= 0 ? lines[promoIdx] : "";
      const codeMatch = promoLine.match(/Promocode\s*:?\s*([A-Z0-9]+)/i);
      const promocode = codeMatch ? codeMatch[1].toUpperCase() : "";

      // Avoid garbage entries
      if (!title || !promocode) continue;

      cards.push({ title, tags: Array.from(new Set(tags)), bullets, promocode });
    }

    // De-duplicate by promocode
    const byCode = new Map();
    for (const c of cards) byCode.set(c.promocode, c);

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
})();
