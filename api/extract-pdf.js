const EXTRACT_SYSTEM_PROMPT = `Voce extrai dados de um romaneio/PDF de entregas (Shopee/Temu).
Devolva APENAS um JSON array, sem markdown, sem texto antes ou depois, no formato:
[{"nome": "", "whatsapp": "", "endereco": "", "bairro": ""}]
Regras:
- whatsapp: somente digitos, com DDD, sem +55, sem espacos ou traços. Se nao achar, deixe "".
- endereco: rua, numero e complemento, SEM o bairro.
- bairro: tente identificar separado do endereco. Se nao conseguir separar, deixe "".
- nome: nome do destinatario. Se nao achar, deixe "".
- Nao invente nenhuma informacao que nao esteja no documento.
- Se o documento nao tiver dados de entrega nenhum, devolva [].`;

// Proxy server-side para a API da Anthropic: mantém ANTHROPIC_API_KEY fora do bundle do navegador.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada no servidor." });
    return;
  }

  const { base64Data } = req.body || {};
  if (!base64Data) {
    res.status(400).json({ error: "base64Data é obrigatório." });
    return;
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 4096,
        system: EXTRACT_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64Data } },
              { type: "text", text: "Extraia a lista de entregas deste PDF em JSON." },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      res.status(502).json({ error: `Anthropic API retornou ${response.status}: ${text}` });
      return;
    }

    const data = await response.json();
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: "Falha ao chamar a API de extração." });
  }
}
