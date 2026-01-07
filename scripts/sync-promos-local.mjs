import { chromium } from "playwright";
import fs from "node:fs";

const SOURCE_URL = "https://www.betus.com.pa/promotions/";
const OUT_PATH = "data/promos.json";

function clean(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(SOURCE_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector("text=/Promocode\\s*/i", { timeout: 90000 });
  await page.waitForTimeout(2500);

  const blocks = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("*"))
      .filter((el) => /Promocode\s*/i.test(el.textContent || ""));
    const seen = new Set();
    const out = [];

    for (const el of els) {
      let card = el.closest("article, li, section, div");
      for (let i = 0; i < 7 && card && card.parentElement; i++) {
        const t = (card.innerText || "").trim();
        if (t.includes("Promocode") && t.length > 120) break;
        card = card.parentElement;
      }
      if (!card) continue;

      const text = (card.innerText || "").trim();
      if (!text.includes("Promocode")) continue;
      if (text.length < 120 || text.length > 4000) continue;

      if (seen.has(text)) continue;
      seen.add(text);
      out.push(text);
    }
    return out;
  });

  await browser.close();

  const knownTags = new Set(["SIGN-UP", "SPORTSBOOK", "CASINO", "CRYPTO", "RE-UP"]);

  const promos = blocks.map((raw) => {
    const lines = raw.split("\n").map(clean).filter(Boolean);

    const promoLine = lines.find((l) => /^Promocode\b/i.test(l)) || "";
    const m = promoLine.match(/Promocode\s*:?\s*([A-Z0-9]+)/i);
    const promocode = m ? m[1].toUpperCase() : "";
    const tags = lines.filter((l) => knownTags.has(l.toUpperCase())).map((l) => l.toUpperCase());

    const title = lines.find(
      (l) =>
        l.length >= 6 &&
        !knownTags.has(l.toUpperCase()) &&
        !/^Promocode\b/i.test(l) &&
        !/^(Join Now|Bonus Details)/i.test(l)
    ) || "";

    const titleIdx = lines.indexOf(title);
    const promoIdx = lines.findIndex((l) => /^Promocode\b/i.test(l));

    const bullets = lines
      .slice(titleIdx + 1, promoIdx >= 0 ? promoIdx : undefined)
      .filter((l) => !knownTags.has(l.toUpperCase()))
      .filter((l) => !/^(Join Now|Bonus Details)/i.test(l));

    if (!title || !promocode) return null;
    return { title, tags: Array.from(new Set(tags)), bullets, promocode };
  }).filter(Boolean);

  // de-dupe
  const byCode = new Map();
  for (const p of promos) byCode.set(p.promocode, p);

  const payload = {
    lastUpdatedUtc: new Date().toISOString(),
    source: SOURCE_URL,
    promos: Array.from(byCode.values())
  };

  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2), "utf8");

  console.log(`Saved ${payload.promos.length} promos to ${OUT_PATH}`);
  if (payload.promos.length === 0) process.exit(1);
})();
