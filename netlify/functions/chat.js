const https = require('https');

// Faz requisição HTTPS genérica
function httpsRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, data: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

// Busca dados da API-Football (com header correto no servidor)
async function footballGet(endpoint) {
  const key = process.env.FOOTBALL_API_KEY || '449d4a9b3aacdfb1e578319a3aaab560';
  const result = await httpsRequest({
    hostname: 'v3.football.api-sports.io',
    path: endpoint,
    method: 'GET',
    headers: {
      'x-apisports-key': key,
      'x-rapidapi-key': key
    }
  });
  return result.data;
}

// Busca odds da The Odds API
async function oddsGet(endpoint) {
  const key = process.env.ODDS_API_KEY || '7c72e8886ce1153f1efaa6e46dd6baf6';
  const result = await httpsRequest({
    hostname: 'api.the-odds-api.com',
    path: `${endpoint}&apiKey=${key}`,
    method: 'GET',
    headers: { 'User-Agent': 'BetMind/1.0' }
  });
  return result.data;
}

// Encontra time por nome
async function findTeam(name, leagueId) {
  try {
    const enc = encodeURIComponent(name);
    let d = await footballGet(`/teams?name=${enc}&league=${leagueId}&season=2025`);
    if (d.response?.length) return d.response[0].team;
    d = await footballGet(`/teams?search=${enc}`);
    return d.response?.[0]?.team || null;
  } catch { return null; }
}

// Busca estatísticas do time
async function getStats(teamId, leagueId) {
  try {
    const [stats, fixtures] = await Promise.all([
      footballGet(`/teams/statistics?team=${teamId}&league=${leagueId}&season=2025`),
      footballGet(`/fixtures?team=${teamId}&last=5&league=${leagueId}`)
    ]);
    return { stats: stats.response, fixtures: fixtures.response || [] };
  } catch { return { stats: null, fixtures: [] }; }
}

// Busca H2H
async function getH2H(id1, id2) {
  try {
    const d = await footballGet(`/fixtures/headtohead?h2h=${id1}-${id2}&last=10`);
    return d.response || [];
  } catch { return []; }
}

// Busca lesões
async function getInjuries(teamId, leagueId) {
  try {
    const d = await footballGet(`/injuries?team=${teamId}&league=${leagueId}&season=2025`);
    return d.response || [];
  } catch { return []; }
}

// Busca classificação
async function getStanding(teamId, leagueId) {
  try {
    const d = await footballGet(`/standings?league=${leagueId}&season=2025`);
    const standings = d.response?.[0]?.league?.standings?.[0];
    return standings?.find(t => t.team?.id === teamId) || null;
  } catch { return null; }
}

// Busca odds
async function getOdds(leagueId, homeTeam, awayTeam) {
  const sportKeys = {
    71: 'soccer_brazil_campeonato', 39: 'soccer_epl', 140: 'soccer_spain_la_liga',
    78: 'soccer_germany_bundesliga', 135: 'soccer_italy_serie_a',
    61: 'soccer_france_ligue_one', 2: 'soccer_uefa_champs_league'
  };
  try {
    const sport = sportKeys[leagueId] || 'soccer_brazil_campeonato';
    const data = await oddsGet(`/v4/sports/${sport}/odds?regions=eu&markets=h2h&oddsFormat=decimal`);
    if (!Array.isArray(data)) return null;
    const hl = homeTeam.toLowerCase().slice(0, 6);
    const al = awayTeam.toLowerCase().slice(0, 6);
    const game = data.find(g =>
      (g.home_team?.toLowerCase().includes(hl) || hl.includes(g.home_team?.toLowerCase().slice(0, 5))) &&
      (g.away_team?.toLowerCase().includes(al) || al.includes(g.away_team?.toLowerCase().slice(0, 5)))
    );
    if (!game) return null;
    let bestHome = 0, bestDraw = 0, bestAway = 0, bestHomeBook = '', bestDrawBook = '', bestAwayBook = '';
    for (const bk of (game.bookmakers || [])) {
      const h2h = bk.markets?.find(m => m.key === 'h2h');
      if (!h2h) continue;
      const ho = h2h.outcomes?.find(o => o.name === game.home_team)?.price;
      const dr = h2h.outcomes?.find(o => o.name === 'Draw')?.price;
      const aw = h2h.outcomes?.find(o => o.name === game.away_team)?.price;
      if (ho > bestHome) { bestHome = ho; bestHomeBook = bk.title; }
      if (dr > bestDraw) { bestDraw = dr; bestDrawBook = bk.title; }
      if (aw > bestAway) { bestAway = aw; bestAwayBook = bk.title; }
    }
    return bestHome ? { bestHome, bestDraw, bestAway, bestHomeBook, bestDrawBook, bestAwayBook } : null;
  } catch { return null; }
}

// Formata stats do time
function formatStats(team, stats, fixtures) {
  if (!stats) return `${team.name}: dados indisponíveis para 2025.`;
  const s = stats;
  const total = s.fixtures?.played?.total || 0;
  const wins = s.fixtures?.wins?.total || 0;
  const draws = s.fixtures?.draws?.total || 0;
  const losses = s.fixtures?.loses?.total || 0;
  const gf = s.goals?.for?.total?.total || 0;
  const ga = s.goals?.against?.total?.total || 0;
  const avgGF = total ? (gf / total).toFixed(2) : 0;
  const avgGA = total ? (ga / total).toFixed(2) : 0;
  const form = fixtures.slice(0, 5).map(f => {
    const isHome = f.teams?.home?.id === team.id;
    const gFor = isHome ? f.goals?.home : f.goals?.away;
    const gAg = isHome ? f.goals?.away : f.goals?.home;
    return gFor > gAg ? 'V' : gFor < gAg ? 'D' : 'E';
  }).join('') || 'N/D';
  return `${team.name}: ${wins}V ${draws}E ${losses}D em ${total} jogos | Gols: ${gf} marcados (${avgGF}/jogo) / ${ga} sofridos (${avgGA}/jogo) | Forma recente: [${form}]`;
}

// Formata H2H
function formatH2H(h2h, homeId) {
  if (!h2h.length) return 'H2H: sem dados disponíveis.';
  let hw = 0, aw = 0, dr = 0;
  const recent = h2h.slice(0, 5).map(f => {
    if (f.goals.home > f.goals.away) f.teams.home.id === homeId ? hw++ : aw++;
    else if (f.goals.home < f.goals.away) f.teams.away.id === homeId ? hw++ : aw++;
    else dr++;
    return `${f.teams.home.name} ${f.goals.home}-${f.goals.away} ${f.teams.away.name}`;
  });
  return `H2H (${h2h.length} jogos totais): ${hw}V ${dr}E ${aw}D | Últimos: ${recent.join(' / ')}`;
}

// Formata standing
function formatStanding(standing, teamName) {
  if (!standing) return `${teamName}: classificação não disponível.`;
  return `${teamName}: ${standing.rank}º lugar | ${standing.points} pontos | ${standing.goalsDiff > 0 ? '+' : ''}${standing.goalsDiff} saldo de gols`;
}

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: 'Method Not Allowed' };
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }) };
  }

  try {
    const body = JSON.parse(event.body);
    const { model, max_tokens, system, messages } = body;

    // Extrai o texto do usuário para buscar dados
    const userText = messages?.[messages.length - 1]?.content || '';

    // Detecta times no texto
    const teamMatch = userText.match(/([A-ZÀ-Ú][a-zà-ú\-]+(?:[\s\-][A-ZÀ-Ú][a-zà-ú\-]+)*)\s+[xX×]\s+([A-ZÀ-Ú][a-zà-ú\-]+(?:[\s\-][A-ZÀ-Ú][a-zà-ú\-]+)*)/);

    // Detecta liga
    const textLower = userText.toLowerCase();
    const leagueMap = { 'brasileirao': 71, 'brasileirão': 71, 'brasileiro': 71, 'premier': 39, 'la liga': 140, 'bundesliga': 78, 'serie a': 135, 'ligue 1': 61, 'champions': 2, 'libertadores': 13 };
    let leagueId = 71;
    for (const [k, v] of Object.entries(leagueMap)) { if (textLower.includes(k)) { leagueId = v; break; } }

    let dataContext = '';

    if (teamMatch) {
      const homeName = teamMatch[1].trim();
      const awayName = teamMatch[2].trim();

      console.log(`Buscando dados: ${homeName} x ${awayName} (liga ${leagueId})`);

      // Busca times em paralelo
      const [homeTeam, awayTeam] = await Promise.all([
        findTeam(homeName, leagueId),
        findTeam(awayName, leagueId)
      ]);

      console.log(`Times encontrados: ${homeTeam?.name || 'não encontrado'} x ${awayTeam?.name || 'não encontrado'}`);

      if (homeTeam && awayTeam) {
        // Busca todos os dados em paralelo
        const [homeData, awayData, h2h, homeInj, awayInj, homeStand, awayStand, odds] = await Promise.all([
          getStats(homeTeam.id, leagueId),
          getStats(awayTeam.id, leagueId),
          getH2H(homeTeam.id, awayTeam.id),
          getInjuries(homeTeam.id, leagueId),
          getInjuries(awayTeam.id, leagueId),
          getStanding(homeTeam.id, leagueId),
          getStanding(awayTeam.id, leagueId),
          getOdds(leagueId, homeName, awayName)
        ]);

        // Monta contexto completo
        dataContext = `
=== DADOS REAIS DA API-FOOTBALL (Temporada 2025) ===

ESTATÍSTICAS:
${formatStats(homeTeam, homeData.stats, homeData.fixtures)}
${formatStats(awayTeam, awayData.stats, awayData.fixtures)}

CLASSIFICAÇÃO:
${formatStanding(homeStand, homeTeam.name)}
${formatStanding(awayStand, awayTeam.name)}

H2H:
${formatH2H(h2h, homeTeam.id)}

LESÕES/DESFALQUES:
${homeTeam.name}: ${homeInj.length ? homeInj.slice(0, 4).map(i => `${i.player?.name}(${i.reason || 'lesão'})`).join(', ') : 'sem lesões registradas'}
${awayTeam.name}: ${awayInj.length ? awayInj.slice(0, 4).map(i => `${i.player?.name}(${i.reason || 'lesão'})`).join(', ') : 'sem lesões registradas'}

${odds ? `MELHORES ODDS DISPONÍVEIS:
${homeTeam.name}: ${odds.bestHome} (${odds.bestHomeBook})
Empate: ${odds.bestDraw} (${odds.bestDrawBook})
${awayTeam.name}: ${odds.bestAway} (${odds.bestAwayBook})` : 'ODDS: não disponíveis no momento'}
====================================================`;

        console.log('Dados coletados com sucesso');
      } else {
        dataContext = `\nNOTA: Times ${homeName} e/ou ${awayName} não encontrados na API para a temporada 2025. Use seu conhecimento atualizado sobre esses times para a análise.`;
      }
    }

    // Monta mensagens com contexto de dados
    const enrichedMessages = [...messages];
    if (dataContext && enrichedMessages.length > 0) {
      const lastMsg = enrichedMessages[enrichedMessages.length - 1];
      enrichedMessages[enrichedMessages.length - 1] = {
        ...lastMsg,
        content: lastMsg.content + '\n\n' + dataContext
      };
    }

    // Chama Anthropic
    const anthropicBody = JSON.stringify({ model, max_tokens, system, messages: enrichedMessages });
    const result = await httpsRequest({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(anthropicBody)
      }
    }, anthropicBody);

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(result.data)
    };

  } catch (err) {
    console.error('Erro:', err.message);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: err.message })
    };
  }
};
