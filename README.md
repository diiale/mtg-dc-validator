# Validador Duel Commander 500

Valida decks de **Duel Commander 500** (formato 1v1 de Commander com teto de
preço, popular no LigaMagic) a partir de um link do LigaMagic. Ele confere
duas coisas automaticamente:

1. **Preço** — soma o menor preço disponível de cada carta do deck e compara
   com o limite (padrão R$ 500).
2. **Legalidade** — verifica o comandante e as 99 cartas contra a banlist
   oficial do Duel Commander, incluindo a checagem de que o deck tem
   exatamente 100 cartas (comandante incluído).

## Como usar (local)

Precisa ter o [Node.js](https://nodejs.org) instalado (versão 18 ou mais
recente). Não tem nenhuma dependência externa — é tudo Node puro.

**Opção 1 — interface web:**

Dá dois cliques em `start.bat` (Windows). Ele abre um servidor local e já
abre o navegador em `http://localhost:5173`. Cola o link do deck, ajusta o
limite de preço se quiser, e clica em "Validar deck".

Pra rodar manualmente: `node server.js`, depois abre `http://localhost:5173`
no navegador.

**Opção 2 — linha de comando:**

```
node validate-deck.js https://www.ligamagic.com.br/?view=dks/deck&id=10110575
node validate-deck.js 10110575
node validate-deck.js 10110575 --limit=300
```

Retorna o relatório no terminal e sai com código `0` se o deck for válido,
`1` se não for.

## Como funciona por dentro

Tudo fica em [validate-deck.js](validate-deck.js) — a lógica é a mesma seja
rodando via terminal, servidor local, ou hospedado (Vercel/Render).

1. **Busca a banlist** em `duelcommander.org/banlist/` (a fonte oficial e
   atualizada do formato). A página lista cada carta com um atributo
   `data-card-name`, dividida em três seções relevantes:
   - *Banned as Commander only* → pode estar nas 99, não pode ser comandante.
   - *Banned in Deck* + *Banned for Offensive Content* → banida em qualquer
     lugar (nem comandante, nem no deck).
   - Também soma uma lista fixa de cartas estruturalmente banidas (Ante,
     Chaos Orb, Falling Star, Shahrazad) que quase nunca muda.
2. **Busca o deck** na página do LigaMagic. Cada carta lá tem um link pro
   nome em **inglês** (`?card=Sol+Ring`, por exemplo) — é esse nome, não o
   nome em português exibido na tela, que é comparado com a banlist. Isso
   evita problemas de tradução/nome diferente.
3. **Cruza as informações**: soma preço (usando o menor valor de cada
   carta), checa o comandante contra as duas listas de banimento, checa as
   99 contra a lista de banidas-em-qualquer-lugar, e conta o total de cartas
   (deve dar 100, comandante incluído).
4. Devolve um relatório único usado tanto pelo CLI quanto pela interface web.

## Estrutura dos arquivos

| Arquivo | Papel |
|---|---|
| `validate-deck.js` | Toda a lógica de busca e validação. Também funciona como CLI. |
| `server.js` | Servidor local (serve a página e expõe `/api/validate`). |
| `public/index.html` | Interface web (formulário + relatório visual). |
| `api/validate.js` | Mesma API, empacotada como função serverless da Vercel. |
| `vercel.json` / `render.yaml` | Configuração de deploy na Vercel / Render. |
| `start.bat` | Atalho pra abrir tudo de uma vez no Windows. |

## Sobre o bloqueio do Cloudflare no LigaMagic

O `ligamagic.com.br` fica atrás de um Cloudflare que exige resolver um
desafio de JavaScript ("Just a moment...") quando a requisição vem de um IP
de provedor de nuvem/hospedagem — confirmado tanto na Vercel quanto no
Render. Rodando **localmente**, a requisição sai do seu IP residencial e
esse bloqueio não acontece — por isso o uso local funciona sempre, sem
configuração nenhuma.

Se quiser publicar num link único hospedado (em vez de cada pessoa rodar
localmente), o código já tem suporte opcional a um serviço de scraping
anti-bot: configurando a variável de ambiente `SCRAPER_API_KEY` (conta
grátis em [scraperapi.com](https://www.scraperapi.com/)), as buscas no
LigaMagic passam a usar esse serviço para resolver o desafio. Sem essa
variável configurada, o comportamento é o mesmo em qualquer lugar (busca
direta) — é por isso que funciona local sem precisar de nada extra.

## Limitações conhecidas

- Depende da estrutura HTML atual do LigaMagic e do duelcommander.org — se
  algum dos dois mudar o layout da página, o parser pode precisar de ajuste.
- A checagem de "banidas estruturalmente" (cartas de Ante, bordas especiais
  etc.) usa uma lista fixa no código, não é buscada dinamicamente.
- Decks sem uma seção de comandante clara no LigaMagic (listas incompletas)
  aparecem como comandante "não identificado".
