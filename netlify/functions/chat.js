const https = require('https');

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function footballGet(ep) {
  const key = process.env.FOOTBALL_API_KEY || '449d4a9b3aacdfb1e578319a3aaab560';
  try {
    const r = await httpsRequest({
      hostname: 'v3.football.api-sports.io',
      path: ep, method: 'GET',
      headers: { 'x-apisports-key': key }
    });
    return r.data;
  } catch { return { response: [] }; }
}

async function findTeam(name, lid) {
  try {
    let d = await footballGet(`/teams?name=${encodeURIComponent(name)}&league=${lid}&season=2025`);
    if (d.response?.length) return d.response[0].team;
    d = await footballGet(`/teams?search=${encodeURIComponent(name)}`);
    return d.response?.[0]?.team || null;
  } catch { return null; }
}

async function collectMatchData(text) {
  const m = text.match(/([A-ZÀ-Ú][a-zà-ú]+(?:[\s][A-ZÀ-Ú][a-zà-ú]+)*)\s+[xX]\s+([A-ZÀ-Ú][a-zà-ú]+(?:[\s][A-ZÀ-Ú][a-zà-ú]+)*)/);
  if (!m) return '';

  const home = m[1].trim(), away = m[2].trim();
  const t = text.toLowerCase();
  const lid = t.includes('premier') ? 39 : t.includes('la liga') ? 140 : t.includes('bundesliga') ? 78 : 71;

  try {
    const [homeTeam, awayTeam] = await Promise.all([findTeam(home, lid), findTeam(away, lid)]);
    if (!homeTeam || !awayTeam) return `Jogo: ${home} x ${away}. Times não encontrados na API para 2025.`;

    const [hStats, aStats, h2hData] = await Promise.all([
      footballGet(`/teams/statistics?team=${homeTeam.id}&league=${lid}&season=2025`),
      footballGet(`/teams/statistics?team=${awayTeam.id}&league=${lid}&season=2025`),
      footballGet(`/fixtures/headtohead?h2h=${homeTeam.id}-${awayTeam.id}&last=8`)
    ]);

    const fmt = (s, name) => {
      if (!s?.response) return `${name}: sem dados`;
      const r = s.response, t = r.fixtures?.played?.total || 0;
      const gf = r.goals?.for?.total?.total || 0, ga = r.goals?.against?.total?.total || 0;
      const form = (r.fixtures?.wins?.total||0) + 'V' + (r.fixtures?.draws?.total||0) + 'E' + (r.fixtures?.loses?.total||0) + 'D';
      return `${name}: ${form} em ${t}j | ${gf} gols marcados (${t?(gf/t).toFixed(1):0}/j) | ${ga} sofridos`;
    };

    const h2h = h2hData?.response || [];
    let hw=0, aw=0, dr=0;
    h2h.slice(0,5).forEach(f => {
      if(f.goals.home > f.goals.away) f.teams.home.id===homeTeam.id ? hw++ : aw++;
      else if(f.goals.home < f.goals.away) f.teams.away.id===homeTeam.id ? hw++ : aw++;
      else dr++;
    });

    return `DADOS REAIS (API-Football 2025):
${fmt(hStats, homeTeam.name)}
${fmt(aStats, awayTeam.name)}
H2H (${h2h.length} jogos): ${homeTeam.name} ${hw}V ${dr}E ${aw}D ${awayTeam.name}`;
  } catch(e) {
    return `Jogo: ${home} x ${away}. Erro ao buscar dados: ${e.message}`;
  }
}

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: { message: 'ANTHROPIC_API_KEY não configurada no Netlify' } }) };

  try {
    const { messages, system } = JSON.parse(event.body);
    const userText = messages?.[messages.length - 1]?.content || '';

    // Busca dados reais
    const matchData = await collectMatchData(userText);

    // Monta mensagens enriquecidas
    const enriched = [...messages];
    if (matchData) {
      enriched[enriched.length - 1] = {
        ...enriched[enriched.length - 1],
        content: userText + (matchData ? '\n\n' + matchData : '')
      };
    }

    // System prompt curto para não estourar tokens
    const shortSystem = `Você é o BetMind, especialista em apostas esportivas. Use os dados fornecidos para análise.
Sempre indique: 1) Quem tem mais chance de vencer e por quê 2) Probabilidades estimadas 3) Melhor mercado para apostar 4) Veredito: APOSTAR ✅ / EVITAR ❌ / RISCO MODERADO ⚠️
Seja direto e objetivo. Português brasileiro.`;

    const payload = JSON.stringify({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 800,
      system: shortSystem,
      messages: enriched
    });

    console.log('Enviando para Anthropic, tamanho payload:', payload.length, 'bytes');

    const result = await httpsRequest({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, payload);

    console.log('Anthropic status:', result.status, 'tipo:', result.data?.type);

    // Erro da Anthropic
    if (result.data?.type === 'error') {
      const msg = result.data.error?.message || JSON.stringify(result.data.error);
      console.error('Anthropic error:', msg);
      return { statusCode: 200, headers: cors, body: JSON.stringify({ error: { message: msg } }) };
    }

    return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(result.data) };

  } catch (err) {
    console.error('Erro interno:', err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: { message: 'Erro interno: ' + err.message } }) };
  }
};
