import fs from "node:fs";
import * as cheerio from "cheerio";

const SOURCE_URL = "https://www.betus.com.pa/promotions/";
const OUT_PATH = "data/promos.json";

function clean(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function extractPromosFromTextBlock(text) {
  // Split into logical lines; preserve order.
  const lines = text
    .split("\n")
    .map(clean)
    .filter(Boolean);

  const knownTags = new Set(["SIGN-UP", "SPORTSBOOK", "CASINO", "CRYPTO", "RE-UP"]);
  const tags = lines
    .filter((l) => knownTags.has(l.toUpperCase()))
    .map((l) => l.toUpperCase());

  // Find promo code line and actual code
  const promoLine = lines.find((l) => /^Promocode\b/i.test(l)) || "";
  const codeMatch = promoLine.match(/Promocode\s*:?\s*([A-Z0-9]+)/i);
  const promocode = codeMatch ? codeMatch[1].toUpperCase() : "";

  // Title: first substantial line that is not a tag and not the promocode line
  const title =
    lines.find(
      (l) =>
        l.length >= 6 &&
        !knownTags.has(l.toUpperCase()) &&
        !/^Promocode\b/i.test(l)
    ) || "";

  // Bullets: everything between title and promo line, excluding tags
  const titleIdx = lines.indexOf(title);
  const promoIdx = lines.findIndex((l) => /^Promocode\b/i.test(l));
  const bullets = lines
    .slice(titleIdx + 1, promoIdx >= 0 ? promoIdx : undefined)
    .filter((l) => !knownTags.has(l.toUpperCase()))
    .filter((l) => l.length >= 3);

  if (!title || !promocode) return null;

  return {
    title,
    tags: Array.from(new Set(tags)),
    bullets,
    promocode
  };
}

async function fetchWithTimeout(url, ms = 90000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        // CI-friendly headers
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        "accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9"
      }
    });

    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

(async () => {
  // 2 attempts (BetUS can be intermittently slow)
  let html = "";
  let lastErr = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      html = await fetchWithTimeout(SOURCE_URL, 90000);
      break;
    } catch (e) {
      lastErr = e;
      if (attempt === 2) throw e;
    }
  }

  const $ = cheerio.load(html);

  // Heuristic: find containers that include “Promocode”
  // We search for elements containing the text, then walk up to a reasonable card container.
  const candidates = new Set();

  $(":contains('Promocode')").each((_, el) => {
    const node = $(el);

    // Climb up a few levels to get a full promo “card”
    let card = node.closest("article, section, div");
    for (let i = 0; i < 6 && card.length; i++) {
      const t = clean(card.text());
      if (t.split("Promocode").length >= 2 || t.length > 120) break;
      card = card.parent();
    }

    if (card && card.length) {
      const t = clean(card.text());
      if (t.includes("Promocode")) candidates.add(t);
    }
  });

  const promos = [];
  for (const text of candidates) {
    // Reconstruct line breaks from punctuation by reintroducing separators
    // so extraction is more stable.
    const block = text
      .replace(/(SIGN-UP|SPORTSBOOK|CASINO|CRYPTO|RE-UP)/g, "\n$1\n")
      .replace(/Promocode\s*:?\s*/gi, "\nPromocode: ")
      .replace(/\.\s+/g, ".\n")
      .replace(/•/g, "\n");

    const promo = extractPromosFromTextBlock(block);
    if (promo) promos.push(promo);
  }

  // De-dupe by promocode
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

  // Fail loudly if we extracted nothing (usually indicates blocking or HTML changed)
  if (payload.promos.length === 0) {
    throw new Error(
      "Extracted 0 promos. BetUS page structure may have changed or the request was blocked."
    );
  }
})();
