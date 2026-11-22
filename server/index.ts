import 'dotenv/config';
import { app } from './app.ts';
import { aiProvider } from './ai.ts';
import { whatsappConfig, whatsappEnabled } from './whatsapp.ts';
import express from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
const dist = resolve('dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve(dist, 'index.html')));
}
app.listen(Number(process.env.PORT || 3001), '127.0.0.1', () => {
  console.log(`Autoagenda API: http://127.0.0.1:${process.env.PORT || 3001}`);
  console.log(`IA: ${aiProvider()}`);
  console.log(
    whatsappEnabled()
      ? `WhatsApp: ativo; webhook em /api/whatsapp/webhook${whatsappConfig().appSecret ? '' : ' (defina WHATSAPP_APP_SECRET para conferir a assinatura da Meta)'}`
      : 'WhatsApp: não configurado; use o simulador do painel.',
  );
  if (aiProvider() === 'ollama') void warmUpOllama();
});

/** Loads the local model into memory at startup so the first chat message is not the slow one. */
async function warmUpOllama() {
  const base = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
  const model = process.env.OLLAMA_MODEL || 'qwen3:4b';
  try {
    const response = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: '', keep_alive: '30m' }),
      signal: AbortSignal.timeout(180000),
    });
    console.log(
      response.ok
        ? `Ollama: modelo ${model} carregado.`
        : `Ollama: não foi possível carregar ${model} (HTTP ${response.status}). Rode "ollama pull ${model}".`,
    );
  } catch {
    console.log(`Ollama: não respondeu em ${base}. Abra o Ollama e reinicie "npm run dev".`);
  }
}
