/* ==========================================================================
   Urbanita — a random bit of trivia about a city
   Pure logic: no DOM access anywhere in this file.

   Where the trivia comes from: the city's own Wikipedia article, the whole
   of it rather than the summary the card already shows. Long city articles
   are full of the things a trivia card wants — the oldest bookshop still
   trading, the first city to do something, the only one that does another,
   the nickname and where it came from — buried mid-paragraph under History
   or Culture, where almost nobody reads them. This digs them out.

   One request (TextExtracts, as plain text with the section headings kept),
   straight from the browser: the MediaWiki API is CORS-open with origin=*,
   like the search the site already does, so no Worker is involved.

   ---- What counts as trivia ----
   A sentence, from anywhere but the lead (the card already says all that)
   and the reference-ish tail sections, that:

     - has a hook: a superlative or a first, a nickname, a record, a
       legend — HOOK below. That's what separates "Lisbon is one of the
       oldest cities in the world" from "Lisbon has a Mediterranean climate";
     - stands on its own: it doesn't open by pointing back at a sentence the
       reader can't see ("This", "However", "He") — ORPHAN;
     - is a readable length, and isn't a fragment of a list, a table or a
       formula that plain-text extraction left behind.

   pickTrivia() hands back every sentence that passes, in article order; the
   page shuffles them, so "random" is the page's job and this stays testable.
   ========================================================================== */

import { API_USER_AGENT } from './wiki.js';

const WP_API = 'https://en.wikipedia.org/w/api.php';

const MIN_LENGTH = 60;
const MAX_LENGTH = 260;

/* Sections whose text is about sources, other places, or lists of names —
   none of it trivia about the city, and the lists split into sentence-shaped
   junk. Demographics and government go too: their superlatives are census
   rankings ("the largest religion is…", "the 5 largest foreign countries of
   birth are…"), never the kind of thing anyone repeats at dinner. Matched on the heading, case-insensitively, at any depth. */
const SKIP_SECTIONS = /^(see also|references|notes|footnotes|citations|sources|bibliography|further reading|external links|gallery|twin towns|sister cities|international relations|partner cities|notable people|people|list of|demographics|population|politics|government|administration|law and government)/i;

const HOOK = new RegExp('\\b(?:' + [
  'oldest', 'largest', 'biggest', 'longest', 'tallest', 'highest', 'lowest',
  'smallest', 'busiest', 'earliest', 'deepest', 'most visited',
  'world\'s', 'nicknamed', 'nickname', 'named after', 'named for',
  'legend', 'legendary', 'unique', 'invented', 'birthplace of', 'originated',
  'famously',
  // "only" and "first" are mostly plain words — "only 72 inhabitants", "in
  // the first years of the century" — so they only count in the shapes
  // where they claim something.
  'the only', 'one of only', 'the last remaining',
  'the first(?! (?:years?|half|decades?|centur\\w*|months?|days?|weeks?|time|quarter|part|stage|phase|round))',
  'world record', 'on record', 'record-breaking'
].join('|') + ')\\b', 'i');

/* A census sentence ("35,273 comprising over 75%… next largest group at
   5,887") trips the superlatives without being trivia. More than this many
   figures and it's a table that happens to be written as prose. */
const MAX_FIGURES = 3;

/* Openings that lean on the sentence before — fine in the article, opaque
   on a card of their own. "It" included: it's the city often enough, but
   "It is the oldest and largest golf club in Iceland" is a golf club. And
   the ones placing something relative to the last thing mentioned —
   "Nearby is the Teatro di San Carlo" — near what? */
const ORPHAN = /^(?:it|its|this|these|those|that|such|he|she|his|her|they|their|them|however|also|both|another|other|the latter|the former|in addition|additionally|moreover|furthermore|meanwhile|similarly|likewise|nevertheless|instead|thus|therefore|here|there|nearby|next to it|beside it|opposite|across the|behind it|further|farther)\b/i;

/* The same thing mid-sentence: "Reykjavík was one of them and the only one
   to hold on to the charter" — one of what? */
const BACK_REFERENCE = /\b(?:one of them|of these|of those|of them|the latter|the former|the same year)\b/i;

/* What extraction leaves behind of tables, lists and formulas. */
const DEBRIS = /[{}|\\=]|\s{2,}|\.\.\.|…|:$/;

/* Abbreviations whose full stop doesn't end a sentence. */
const ABBREVIATION = /(?:\b(?:St|Mt|Dr|Mr|Mrs|Ms|Jr|Sr|No|Co|Inc|Ltd|vs|c|ca|approx|est|al|e\.g|i\.e|U\.S|U\.K|A\.D|B\.C)|\b[A-Z])\.$/;

/** "== History ==" -> "History"; anything else -> null. */
function headingOf(line) {
  const m = /^(={2,6})\s*(.*?)\s*\1\s*$/.exec(line.trim());
  return m ? m[2] : null;
}

/** A paragraph into sentences, without breaking on "St." or "c. 1200". */
export function splitSentences(paragraph) {
  const pieces = (paragraph || '').split(/(?<=[.!?]["”’)]?)\s+(?=["“(]?[A-Z0-9])/);
  const out = [];
  for (const piece of pieces) {
    if (out.length && ABBREVIATION.test(out[out.length - 1])) {
      out[out.length - 1] += ' ' + piece;
    } else {
      out.push(piece);
    }
  }
  return out.map(s => s.trim()).filter(Boolean);
}

/** Whether one sentence would make a card on its own. */
export function isTrivia(sentence) {
  const s = (sentence || '').trim();
  if (s.length < MIN_LENGTH || s.length > MAX_LENGTH) return false;
  if (!/[.!]["”’)]?$/.test(s)) return false;
  if (!/^["“]?[A-Z0-9]/.test(s)) return false;
  if (ORPHAN.test(s.replace(/^["“]/, ''))) return false;
  if (BACK_REFERENCE.test(s)) return false;
  if (DEBRIS.test(s)) return false;
  if ((s.match(/\d[\d,.]*/g) || []).length > MAX_FIGURES) return false;
  return HOOK.test(s);
}

/**
 * Every trivia-worthy sentence in a plain-text article, in article order:
 * [{ text, section }]. `section` is the top-level heading it sits under, as
 * a little context ("From History"). The lead is skipped: it's the summary
 * the card already shows. Always returns an array.
 */
export function pickTrivia(extract) {
  const out = [];
  const seen = new Set();
  let section = null;        // null until the first heading: the lead
  let skipping = true;
  let skipDepth = 0;

  for (const line of (extract || '').split('\n')) {
    const heading = headingOf(line);
    if (heading !== null) {
      const depth = line.trim().match(/^=+/)[0].length;
      if (depth === 2) section = heading;
      // A skipped section takes its subsections with it, until the next
      // heading at its own depth or above.
      if (skipping && skipDepth && depth > skipDepth) continue;
      skipping = SKIP_SECTIONS.test(heading);
      skipDepth = skipping ? depth : 0;
      continue;
    }
    if (skipping || !section) continue;

    for (const sentence of splitSentences(line)) {
      if (!isTrivia(sentence) || seen.has(sentence)) continue;
      seen.add(sentence);
      out.push({ text: sentence, section });
    }
  }
  return out;
}

/**
 * Trivia for a city, in article order (the page shuffles), each with a link
 * to the section it came from: [{ text, section, url }]. Always resolves:
 * an article with nothing that qualifies, a malformed response, or
 * Wikipedia being unreachable all yield [] — no section, not an error. Only
 * AbortError propagates, so a superseded search still cancels cleanly.
 */
export async function fetchCityTrivia(title, signal) {
  if (!title) return [];
  const params = new URLSearchParams({
    action: 'query', prop: 'extracts', explaintext: '1', exsectionformat: 'wiki',
    redirects: '1', titles: title, format: 'json', formatversion: '2', origin: '*'
  });

  let data;
  try {
    const res = await fetch(WP_API + '?' + params, {
      signal,
      headers: { 'Accept': 'application/json', 'Api-User-Agent': API_USER_AGENT }
    });
    if (!res.ok) return [];
    data = await res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    return [];
  }

  const page = data?.query?.pages?.[0];
  if (typeof page?.extract !== 'string') return [];

  // Each one links to its own section of the article: the sentence is
  // Wikipedia's (CC BY-SA), and the section is where the rest of the story is.
  const article = 'https://en.wikipedia.org/wiki/' + encodeURIComponent((page.title || title).replace(/ /g, '_'));
  return pickTrivia(page.extract).map(item => ({
    ...item,
    url: article + '#' + encodeURIComponent(item.section.replace(/ /g, '_'))
  }));
}
