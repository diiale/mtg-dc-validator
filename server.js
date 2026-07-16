#!/usr/bin/env node
// Servidor local da interface web. Busca duelcommander.org/ligamagic.com.br
// aqui no servidor porque o navegador bloqueia isso direto do HTML (CORS).
//
// Uso: node server.js  (depois abra http://localhost:5173)

const http = require('http');
const fs = require('fs');
const path = require('path');
const { validateDeck } = require('./validate-deck.js');

const PORT = process.env.PORT || 5173;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

async function handleRequest(req, res) {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);

  if (reqUrl.pathname === '/api/validate') {
    const deck = reqUrl.searchParams.get('deck');
    const limitParam = parseFloat(reqUrl.searchParams.get('limit'));
    const limit = Number.isFinite(limitParam) ? limitParam : 500;

    if (!deck || !deck.trim()) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Informe o link ou o ID do deck do LigaMagic.' }));
      return;
    }

    console.log(`[validate] deck=${deck.trim()} limit=${limit}`);
    try {
      const report = await validateDeck(deck.trim(), limit);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(report));
      console.log(`[validate] ok - total=${report.total} isLegal=${report.isLegal}`);
    } catch (err) {
      console.error('[validate] erro:', err.message);
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  let filePath = reqUrl.pathname === '/' ? '/index.html' : reqUrl.pathname;
  filePath = path.normalize(path.join(PUBLIC_DIR, filePath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Acesso negado.');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Nao encontrado.');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  // Sem isso, um erro inesperado aqui derrubaria o processo inteiro e todo
  // request seguinte do navegador daria "Failed to fetch" — mesmo sem relação
  // com o que causou o erro original.
  handleRequest(req, res).catch((err) => {
    console.error('[server] erro nao tratado na requisicao:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Erro interno no servidor: ' + err.message }));
    } else {
      res.end();
    }
  });
});

process.on('uncaughtException', (err) => {
  console.error('[server] uncaughtException (servidor continua rodando):', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[server] unhandledRejection (servidor continua rodando):', err);
});

server.listen(PORT, () => {
  console.log(`Validador de Duel Commander 500 rodando em http://localhost:${PORT}`);
  console.log('Deixe esta janela aberta enquanto estiver usando. Feche-a (Ctrl+C) para encerrar.');
});
