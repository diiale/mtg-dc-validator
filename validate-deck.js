#!/usr/bin/env node
// Validador de decks de Duel Commander 500 (LigaMagic) contra a banlist
// oficial do Duel Commander (duelcommander.org/banlist/).
//
// Nota: existe uma pagina antiga (mtgdc.info) que ficou desatualizada -- ela
// mesma se declara substituida ("replaced with AeonShift") e nao reflete mais
// a banlist em vigor. A comunidade brasileira (ligamagic.com.br, mtgdc500.com.br)
// segue duelcommander.org, entao e' essa a fonte usada aqui.
//
// Uso:
//   node validate-deck.js <url-ou-id-do-deck-ligamagic> [--limit=500]
//
// Exemplos:
//   node validate-deck.js "https://www.ligamagic.com.br/?view=dks/deck&id=10110575"
//   node validate-deck.js 10110575
//   node validate-deck.js 10110575 --limit=300

const BANNED_LIST_URL = 'https://www.duelcommander.org/banlist/';
const DEFAULT_PRICE_LIMIT = 500;
const REQUIRED_DECK_SIZE = 100; // comandante(s) + 99 (ou 98+2 com parceiro)
// Cabecalhos parecidos com os de um navegador real -- sites atras de
// Cloudflare (ligamagic.com.br, duelcommander.org) tem WAFs que bloqueiam
// requisicoes que parecem vir de bot/datacenter com mais facilidade quando
// faltam headers comuns de navegador (Accept, Accept-Language, etc).
const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
};

// Cartas de Ante/fisicas/subgame da secao "Structurally Banned Cards" de
// duelcommander.org. A pagina cita so alguns exemplos (ex: "Contract from
// Below" + a categoria "All ante cards"); mantemos aqui a lista completa e
// nominal das 9 cartas historicas com habilidade de Ante (fixas desde sempre,
// nao mudam com atualizacoes de banlist) mais as cartas fisicas/subgame.
const STRUCTURALLY_BANNED_NAMED_CARDS = [
  'Amulet of Quoz', 'Bronze Tablet', 'Contract from Below', 'Darkpact',
  'Demonic Attorney', 'Jeweled Bird', 'Rebirth', 'Tempest Efreet',
  'Timmerian Fiends', 'Falling Star', 'Chaos Orb', 'Shahrazad',
];

function normalizeName(name) {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[‘’`´']/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function decodeEntities(text) {
  const named = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
    rsquo: '’', lsquo: '‘', nbsp: ' ',
  };
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => (named[name] !== undefined ? named[name] : m));
}

function parseBRL(str) {
  if (!str) return 0;
  const cleaned = str.replace(/[^\d.,-]/g, '').replace(/\./g, '').replace(',', '.');
  const val = parseFloat(cleaned);
  return Number.isFinite(val) ? val : 0;
}

// Configuravel via env var: em hospedagens serverless (ex: Vercel Hobby) as
// funcoes tem um limite duro de execucao (10-15s), entao vale um timeout
// interno mais curto para falhar com mensagem clara antes desse limite.
const FETCH_TIMEOUT_MS = parseInt(process.env.FETCH_TIMEOUT_MS, 10) || 20000;

// ligamagic.com.br fica atras de um Cloudflare que exige resolver um desafio
// de JavaScript ("Just a moment...") quando a requisicao vem de IP de
// provedor de nuvem/hospedagem (Vercel, Render, AWS, etc. -- confirmado nos
// dois). Um fetch() simples nunca resolve isso, entao quando SCRAPER_API_KEY
// estiver configurada, essas requisicoes passam pelo ScraperAPI (que roda um
// navegador de verdade e resolve o desafio). duelcommander.org nao tem
// Cloudflare, entao continua indo direto (nao gasta credito do plano).
const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY || '';
const SCRAPER_API_URL = 'https://api.scraperapi.com/';

function needsScraperProxy(url) {
  return SCRAPER_API_KEY && url.includes('ligamagic.com.br');
}

async function fetchText(url) {
  const targetUrl = needsScraperProxy(url)
    ? `${SCRAPER_API_URL}?api_key=${SCRAPER_API_KEY}&url=${encodeURIComponent(url)}&render=true&country_code=br`
    : url;

  let res;
  try {
    res = await fetch(targetUrl, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error(`Tempo esgotado ao buscar ${url} (${FETCH_TIMEOUT_MS / 1000}s). O site pode estar fora do ar ou bloqueando a requisicao.`);
    }
    throw new Error(`Falha de rede ao buscar ${url}: ${err.message}`);
  }
  if (!res.ok) {
    const cfRay = res.headers.get('cf-ray');
    const bodySnippet = (await res.text().catch(() => '')).slice(0, 200).replace(/\s+/g, ' ').trim();
    throw new Error(
      `Falha ao buscar ${url}: HTTP ${res.status}` +
      (cfRay ? ` (cf-ray: ${cfRay})` : '') +
      (bodySnippet ? ` -- resposta: "${bodySnippet}"` : '')
    );
  }
  return res.text();
}

// ---------- Lista de banidos (duelcommander.org) ----------
//
// A pagina renderiza cada carta como:
//   <div class="ban-grid" id="banned-commanders" ...> ... </div>
// com um <div class="ban-item ..." data-card-name="Nome Da Carta"> por carta.
// Extraimos pelo id do container ate o proximo container/heading.

function extractCardNamesFromContainer(html, containerId) {
  const startRe = new RegExp(`<div class="ban-grid" id="${containerId}"[^>]*>`);
  const startMatch = startRe.exec(html);
  if (!startMatch) return [];

  const rest = html.slice(startMatch.index + startMatch[0].length);
  const endPatterns = [/<div class="ban-grid"/, /<h2[ >]/, /<div class="rules-grid"/];
  const endPositions = endPatterns
    .map((p) => p.exec(rest))
    .filter(Boolean)
    .map((m) => m.index);
  const end = endPositions.length ? Math.min(...endPositions) : rest.length;
  const section = rest.slice(0, end);

  const names = [];
  const nameRe = /data-card-name="([^"]+)"/g;
  let m;
  while ((m = nameRe.exec(section))) names.push(decodeEntities(m[1]));
  return names;
}

async function fetchBannedLists() {
  const html = await fetchText(BANNED_LIST_URL);

  const commanderOnlyRaw = extractCardNamesFromContainer(html, 'banned-commanders');
  const bannedInDeckRaw = extractCardNamesFromContainer(html, 'banned-cards');
  const offensiveRaw = extractCardNamesFromContainer(html, 'offensive-cards');

  if (commanderOnlyRaw.length === 0 || bannedInDeckRaw.length === 0) {
    throw new Error('Nao foi possivel extrair a banlist de duelcommander.org (0 cartas encontradas). O site pode ter mudado de estrutura.');
  }

  // "offensive-cards" (conteudo ofensivo) tambem sao banidas em qualquer
  // lugar, igual as de "banned-cards" -- so ficam numa secao separada por
  // motivo de contexto/aviso, nao por regra diferente.
  const fullyBannedRaw = [...bannedInDeckRaw, ...offensiveRaw, ...STRUCTURALLY_BANNED_NAMED_CARDS];

  return {
    commanderOnlyBanned: new Map(commanderOnlyRaw.map((n) => [normalizeName(n), n])),
    fullyBanned: new Map(fullyBannedRaw.map((n) => [normalizeName(n), n])),
  };
}

// ---------- Deck (LigaMagic) ----------

function resolveDeckUrl(input) {
  if (/^\d+$/.test(input.trim())) {
    return `https://www.ligamagic.com.br/?view=dks/deck&id=${input.trim()}`;
  }
  return input;
}

function buildPriceMap(html) {
  // <img ... id="card_<linkMobile>" price-min='...' ...> aparece em varias
  // visualizacoes da mesma pagina; usamos a primeira ocorrencia de cada id.
  const priceMap = new Map();
  const re = /id="card_(\d+)"\s+price-min=['"]([^'"]*)['"]/g;
  let m;
  while ((m = re.exec(html))) {
    if (!priceMap.has(m[1])) priceMap.set(m[1], parseBRL(m[2]));
  }
  return priceMap;
}

function parseDeck(html) {
  const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1]).trim() : '(sem titulo)';

  const priceMap = buildPriceMap(html);

  const markerRe = /<div class=['"]deck-line['"]>/g;
  const positions = [];
  let m;
  while ((m = markerRe.exec(html))) positions.push(m.index);

  let currentSection = '';
  const seen = new Set();
  const cards = []; // { section, qty, ptName, enName, unitPrice }

  for (let i = 0; i < positions.length; i++) {
    const start = positions[i];
    const end = i + 1 < positions.length ? positions[i + 1] : Math.min(html.length, start + 3000);
    const chunk = html.slice(start, end);

    if (chunk.includes('deck-type')) {
      const sm = chunk.match(/deck-type[^'"]*['"]>([^<]+)<i>/);
      if (sm) currentSection = decodeEntities(sm[1]).trim();
      continue;
    }
    if (!chunk.includes('deck-qty')) continue;

    const qtyM = chunk.match(/deck-qty['"]>(\d+)/);
    const idM = chunk.match(/link-mobile=['"](\d+)['"]/);
    const ptNameM = chunk.match(/data-lc-name=['"]([^'"]+)['"]/);
    const hrefM = chunk.match(/href="([^"]+)"/);
    if (!qtyM || !idM || !ptNameM || !hrefM) continue;

    const linkId = idM[1];
    if (seen.has(linkId)) continue; // ja processado em outra visualizacao da pagina
    seen.add(linkId);

    const cardParam = hrefM[1].split('card=')[1] || '';
    const enName = decodeEntities(decodeURIComponent(cardParam.replace(/\+/g, ' ')));

    cards.push({
      section: currentSection,
      qty: parseInt(qtyM[1], 10),
      ptName: decodeEntities(ptNameM[1]),
      enName,
      unitPrice: priceMap.get(linkId) || 0,
    });
  }

  const commanderCards = cards.filter((c) => /comandante/i.test(c.section));
  const deckCards = cards.filter((c) => !/comandante/i.test(c.section));

  return { title, commanderCards, deckCards, allCards: cards };
}

// ---------- Validacao ----------

function checkCardAgainstBans(card, bannedLists) {
  const namesToCheck = [...new Set([card.enName, ...card.enName.split(' // ')])];
  const violations = [];
  for (const raw of namesToCheck) {
    const norm = normalizeName(raw);
    if (bannedLists.fullyBanned.has(norm)) {
      violations.push({ type: 'banido', matched: bannedLists.fullyBanned.get(norm) });
    } else if (bannedLists.commanderOnlyBanned.has(norm)) {
      violations.push({ type: 'restrito-como-comandante', matched: bannedLists.commanderOnlyBanned.get(norm) });
    }
  }
  return violations;
}

async function validateDeck(input, priceLimit) {
  const deckUrl = resolveDeckUrl(input);

  const [bannedLists, deckHtml] = await Promise.all([
    fetchBannedLists(),
    fetchText(deckUrl),
  ]);

  const deck = parseDeck(deckHtml);

  const total = deck.allCards.reduce((sum, c) => sum + c.qty * c.unitPrice, 0);

  const commanderIssues = [];
  for (const cmd of deck.commanderCards) {
    const namesToCheck = [...new Set([cmd.enName, ...cmd.enName.split(' // ')])];
    for (const raw of namesToCheck) {
      const norm = normalizeName(raw);
      if (bannedLists.fullyBanned.has(norm)) {
        commanderIssues.push(`"${cmd.ptName}" (${cmd.enName}) esta banido em qualquer parte do deck (${bannedLists.fullyBanned.get(norm)}).`);
      } else if (bannedLists.commanderOnlyBanned.has(norm)) {
        commanderIssues.push(`"${cmd.ptName}" (${cmd.enName}) nao pode ser usado como comandante (banido como comandante).`);
      }
    }
  }

  const deckCardIssues = [];
  for (const card of deck.deckCards) {
    const violations = checkCardAgainstBans(card, bannedLists);
    for (const v of violations) {
      if (v.type === 'banido') {
        deckCardIssues.push(`"${card.ptName}" (${card.enName}) esta banido em Duel Commander (${v.matched}).`);
      }
      // 'restrito-como-comandante' fora do slot de comandante e' legal, nao gera violacao.
    }
  }

  const bannedNamesInDeck = new Set();
  for (const card of deck.deckCards) {
    if (checkCardAgainstBans(card, bannedLists).some((v) => v.type === 'banido')) {
      bannedNamesInDeck.add(card.enName);
    }
  }

  const cardCount = deck.allCards.reduce((sum, c) => sum + c.qty, 0);
  const deckSizeIssues = [];
  if (cardCount !== REQUIRED_DECK_SIZE) {
    const diff = REQUIRED_DECK_SIZE - cardCount;
    deckSizeIssues.push(
      cardCount < REQUIRED_DECK_SIZE
        ? `O deck tem ${cardCount} cartas, faltam ${diff} para completar ${REQUIRED_DECK_SIZE} (comandante incluido).`
        : `O deck tem ${cardCount} cartas, ${-diff} a mais do que o permitido (${REQUIRED_DECK_SIZE}, comandante incluido).`
    );
  }

  return {
    deckUrl,
    title: deck.title,
    commander: deck.commanderCards.map((c) => `${c.ptName} (${c.enName})`).join(' + ') || '(nao identificado)',
    total,
    priceLimit,
    withinBudget: total <= priceLimit,
    cardCount,
    requiredCardCount: REQUIRED_DECK_SIZE,
    isCardCountValid: cardCount === REQUIRED_DECK_SIZE,
    commanderIssues,
    deckCardIssues,
    deckSizeIssues,
    isLegal: commanderIssues.length === 0 && deckCardIssues.length === 0 && deckSizeIssues.length === 0,
    cards: deck.allCards.map((c) => ({
      section: c.section,
      qty: c.qty,
      ptName: c.ptName,
      enName: c.enName,
      unitPrice: c.unitPrice,
      lineTotal: c.qty * c.unitPrice,
      isCommander: /comandante/i.test(c.section),
      isBanned: bannedNamesInDeck.has(c.enName),
    })),
  };
}

function printReport(r) {
  console.log('=== Validador de Deck - Duel Commander 500 ===');
  console.log(`Deck: ${r.title}`);
  console.log(`URL:  ${r.deckUrl}`);
  console.log(`Comandante: ${r.commander}`);
  console.log('');
  console.log(`Preco total (menor valor disponivel): R$ ${r.total.toFixed(2).replace('.', ',')}`);
  console.log(`Limite:                               R$ ${r.priceLimit.toFixed(2).replace('.', ',')}`);
  console.log(r.withinBudget
    ? `-> Dentro do orcamento (sobram R$ ${(r.priceLimit - r.total).toFixed(2).replace('.', ',')}).`
    : `-> ACIMA do orcamento (excede em R$ ${(r.total - r.priceLimit).toFixed(2).replace('.', ',')}).`);
  console.log('');

  console.log(`Quantidade de cartas: ${r.cardCount} / ${r.requiredCardCount}`);
  if (!r.isCardCountValid) {
    r.deckSizeIssues.forEach((m) => console.log(`  - ${m}`));
  }
  console.log('');

  if (r.commanderIssues.length === 0) {
    console.log('Comandante: OK, nenhum problema de banimento.');
  } else {
    console.log('Comandante: PROBLEMAS ENCONTRADOS:');
    r.commanderIssues.forEach((m) => console.log(`  - ${m}`));
  }
  console.log('');

  if (r.deckCardIssues.length === 0) {
    console.log('Lista de cartas (fora o comandante): nenhuma carta banida encontrada.');
  } else {
    console.log(`Lista de cartas: ${r.deckCardIssues.length} carta(s) banida(s) encontrada(s):`);
    r.deckCardIssues.forEach((m) => console.log(`  - ${m}`));
  }
  console.log('');

  console.log(r.isLegal && r.withinBudget
    ? 'RESULTADO FINAL: DECK VALIDO (dentro do orcamento e sem cartas banidas).'
    : 'RESULTADO FINAL: DECK INVALIDO.');
}

async function main() {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith('--'));
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const priceLimit = limitArg ? parseFloat(limitArg.split('=')[1]) : DEFAULT_PRICE_LIMIT;

  if (positional.length === 0) {
    console.error('Uso: node validate-deck.js <url-ou-id-do-deck-ligamagic> [--limit=500]');
    process.exit(2);
  }

  try {
    const report = await validateDeck(positional[0], priceLimit);
    printReport(report);
    process.exit(report.isLegal && report.withinBudget ? 0 : 1);
  } catch (err) {
    console.error('Erro ao validar o deck:', err.message);
    process.exit(2);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  normalizeName, parseBRL, extractCardNamesFromContainer, fetchBannedLists,
  resolveDeckUrl, buildPriceMap, parseDeck, checkCardAgainstBans, validateDeck,
};
