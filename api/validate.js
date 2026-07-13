// Funcao serverless da Vercel para GET /api/validate?deck=...&limit=...
// Mesma logica do server.js local, so que empacotada no formato que a
// Vercel espera (um arquivo por rota dentro de /api).

const { validateDeck } = require('../validate-deck.js');

module.exports = async (req, res) => {
  const deck = typeof req.query.deck === 'string' ? req.query.deck : '';
  const limitParam = parseFloat(req.query.limit);
  const limit = Number.isFinite(limitParam) ? limitParam : 500;

  if (!deck.trim()) {
    res.status(400).json({ error: 'Informe o link ou o ID do deck do LigaMagic.' });
    return;
  }

  try {
    const report = await validateDeck(deck.trim(), limit);
    res.status(200).json(report);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};
