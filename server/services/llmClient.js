import { config } from '../config.js';

export const SYSTEM_PROMPT = `You are Fake News Checker, an assistant that helps users verify information
before they share it. You do NOT simply declare things true or false. You
guide the user through a short verification checklist, one step at a time:
source credibility, author/byline, publish date, cross-verification with
independent outlets, evidence quality, emotional/manipulative language,
and (for images) reverse-image-search guidance. Ask focused follow-up
questions rather than long question lists. When you reach a verdict, always
give: a verdict (Likely Reliable / Uncertain / Likely False or Misleading),
a confidence level (Low/Medium/High), 2-3 short reasons, and a share
recommendation. Never state unverifiable claims as fact. Never accuse a
named real person or outlet of lying outright — describe what is and isn't
verifiable instead. If you don't have real-time web access, tell the user
plainly and guide them to check manually rather than guessing. Keep tone
calm, neutral, and non-judgmental — never shame the user.`;

/**
 * Calls an external LLM (Anthropic, Gemini, or OpenAI) if an API key is available.
 * Returns null if no external provider is configured or if the call fails.
 */
export async function callExternalLLM({ messages, provider = null }) {
  const selectedProvider = provider || config.llmProvider;

  // 1. Anthropic Claude
  if ((selectedProvider === 'anthropic' || (!provider && config.anthropicApiKey)) && config.anthropicApiKey) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.anthropicApiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          messages: messages.map(m => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: m.content
          }))
        })
      });

      if (response.ok) {
        const data = await response.json();
        return data.content?.[0]?.text || null;
      }
    } catch (err) {
      console.warn('Anthropic API call failed, falling back:', err.message);
    }
  }

  // 2. Google Gemini
  if ((selectedProvider === 'gemini' || (!provider && config.geminiApiKey)) && config.geminiApiKey) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${config.geminiApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents: messages.map(m => ({
              role: m.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: m.content }]
            }))
          })
        }
      );

      if (response.ok) {
        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
      }
    } catch (err) {
      console.warn('Gemini API call failed, falling back:', err.message);
    }
  }

  // 3. OpenAI
  if ((selectedProvider === 'openai' || (!provider && config.openaiApiKey)) && config.openaiApiKey) {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.openaiApiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            ...messages.map(m => ({
              role: m.role === 'assistant' ? 'assistant' : 'user',
              content: m.content
            }))
          ]
        })
      });

      if (response.ok) {
        const data = await response.json();
        return data.choices?.[0]?.message?.content || null;
      }
    } catch (err) {
      console.warn('OpenAI API call failed, falling back:', err.message);
    }
  }

  return null;
}
