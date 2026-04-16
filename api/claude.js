// api/claude.js
// 누수패스 Claude API 프록시
// Vercel Serverless Function

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',   // PDF Base64 전송용 — 기본 4.5mb에서 상향
    },
  },
};

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const body = req.body;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
      },
      body: JSON.stringify({
        model:      body.model      || 'claude-sonnet-4-6',
        max_tokens: body.max_tokens || 2000,
        system:     body.system,
        messages:   body.messages,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[claude.js] API error:', data);
      res.status(response.status).json({ error: data });
      return;
    }

    res.status(200).json(data);
  } catch (err) {
    console.error('[claude.js] Server error:', err.message);
    res.status(500).json({ error: { message: err.message } });
  }
}
