const https = require('https');

exports.handler = async (event) => {
  se (event.httpMethod === 'OPTIONS') {
    retornar {
      código de status: 200,
      cabeçalhos: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      corpo: ''
    };
  }

  se (evento.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Método não permitido' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  se (!apiKey) {
    retornar {
      Código de status: 500,
      cabeçalhos: { 'Access-Control-Allow-Origin': '*' },
      corpo: JSON.stringify({ erro: 'ANTHROPIC_API_KEY não configurada' })
    };
  }

  retornar nova Promise((resolve) => {
    const bodyData = event.body;
    const opções = {
      hostname: 'api.anthropic.com',
      caminho: '/v1/mensagens',
      método: 'POST',
      cabeçalhos: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'versão antrópica': '2023-06-01',
        'Content-Length': Buffer.byteLength(bodyData)
      }
    };

    const req = https.request(options, (res) => {
      seja data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolver({
          código de status: 200,
          cabeçalhos: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json'
          },
          corpo: dados
        });
      });
    });

    req.on('error', (err) => {
      resolver({
        Código de status: 500,
        cabeçalhos: { 'Access-Control-Allow-Origin': '*' },
        corpo: JSON.stringify({ erro: err.message })
      });
    });

    req.write(bodyData);
    req.end();
  });
};
