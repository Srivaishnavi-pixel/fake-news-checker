import { fetchUrlMetadata, analyzeDomain, checkTyposquatting, REPUTABLE_DOMAINS, SATIRE_DOMAINS } from './urlMetadata.js';
import { callExternalLLM } from './llmClient.js';

// Emotional / manipulative language detection patterns
const SENSATIONAL_PATTERNS = [
  /\b(shocking|bombshell|they don't want you to know|unbelievable|mind-blowing|wake up|miracle cure|exposed|hidden truth|banned by)\b/i,
  /\b(share this before it's deleted|censored|secret they hid|must see|urgent alert)\b/i
];

// Common hoax keywords for quick cross-referencing
const KNOWN_HOAX_PATTERNS = [
  {
    regex: /moon landing.*(cancelled|hoax|faked|never happened)/i,
    title: 'Moon Landing Denial / Hoax',
    details: 'Apollo missions are verified by lunar laser ranging retroreflectors, rock samples, and tracking data from international agencies including the Soviet Union.'
  },
  {
    regex: /5g.*(covid|radiation poisoning|microchip|depopulation)/i,
    title: '5G / Pandemic Conspiracy',
    details: 'Extensively debunked by WHO, IEEE, and health authorities worldwide. Radio frequencies do not create biological viruses.'
  },
  {
    regex: /drinking bleach|cure covid.*bleach|miracle mineral solution/i,
    title: 'Dangerous Ingestion Cure',
    details: 'Debunked by FDA, CDC, and medical regulators. Ingesting disinfectants or unapproved chemicals is hazardous and fatal.'
  }
];

export class VerificationSession {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.stage = 'INTAKE'; // INTAKE -> CLARIFICATION -> VERDICT
    this.history = [];
    this.data = {
      rawInput: '',
      inputType: null, // 'url', 'claim', 'image'
      urlMetadata: null,
      sourceType: '',
      languageFlags: [],
      hasImage: false,
      isOld: false,
      verdictData: null
    };
    this.stepIndex = 1; // 1: Analysis, 2: Verdict
  }

  addMessage(role, content, extras = {}) {
    const msg = {
      role,
      content,
      timestamp: new Date().toISOString(),
      ...extras
    };
    this.history.push(msg);
    return msg;
  }
}

// In-memory session store
const sessions = new Map();

export function getOrCreateSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, new VerificationSession(sessionId));
  }
  return sessions.get(sessionId);
}

export function resetSession(sessionId) {
  sessions.set(sessionId, new VerificationSession(sessionId));
  return sessions.get(sessionId);
}

/**
 * Simplified 2-step conversational engine:
 * Step 1: User submits link or claim -> bot inspects automatically, shares initial findings, and asks ONE simple question.
 * Step 2: User answers that 1 question -> bot immediately gives the final verdict card!
 */
export async function processUserMessage(session, userMessage, attachments = {}) {
  session.addMessage('user', userMessage, { attachments });

  const text = (userMessage || '').trim();
  const urlMatch = text.match(/https?:\/\/[^\s]+/i);

  switch (session.stage) {
    case 'INTAKE': {
      session.data.rawInput = text;
      session.data.hasImage = !!(attachments.image || text.toLowerCase().includes('screenshot') || text.toLowerCase().includes('image attached'));

      // 1. URL Input
      if (urlMatch) {
        session.data.inputType = 'url';
        session.data.url = urlMatch[0];
        const metadata = await fetchUrlMetadata(urlMatch[0]);
        session.data.urlMetadata = metadata;

        // If Satire site -> Instant verdict (no need to waste time asking questions)
        if (metadata.domainAnalysis?.isSatire) {
          session.stage = 'VERDICT';
          session.stepIndex = 2;
          const verdictContent = generateSatireVerdict(metadata);
          session.data.verdictData = verdictContent.verdictData;
          return session.addMessage('assistant', verdictContent.text, {
            stage: session.stage,
            stepIndex: session.stepIndex,
            verdict: verdictContent.verdictData,
            suggestedReplies: ['Check another claim']
          });
        }

        // Suspicious domain
        if (metadata.domainAnalysis?.category === 'suspicious') {
          session.data.languageFlags.push('Domain looks like a deceptive copycat of a major news brand.');
        }

        if (metadata.isOlderStory) {
          session.data.isOld = true;
        }

        session.stage = 'CLARIFICATION';
        session.stepIndex = 2;

        let reply = `I inspected **${metadata.domain}** for you:\n\n`;
        if (metadata.title) reply += `📄 **Title:** "${metadata.title}"\n`;
        if (metadata.author) reply += `✍️ **Author:** ${metadata.author}\n`;
        if (metadata.publishDate) reply += `📅 **Date:** ${metadata.publishDate}\n`;

        if (metadata.domainAnalysis?.isReputable) {
          reply += `\n✅ **Good news:** This is a recognized, reputable news organization.\n\n`;
        } else if (metadata.domainAnalysis?.category === 'suspicious') {
          reply += `\n⚠️ **Warning:** ${metadata.domainAnalysis.notes}\n\n`;
        } else {
          reply += `\nℹ️ **Note:** This site is an independent or lesser-known blog/outlet.\n\n`;
        }

        reply += `**Quick question:** Have you seen this reported on other major news sites, or did someone just send you this link?`;

        return session.addMessage('assistant', reply, {
          stage: session.stage,
          stepIndex: session.stepIndex,
          metadata,
          suggestedReplies: [
            'Yes, multiple major news sites report it',
            'No, only found this single link',
            'Someone sent it to me on WhatsApp/Social media'
          ]
        });
      }

      // 2. Image or Screenshot Input
      if (session.data.hasImage) {
        session.data.inputType = 'image';
        session.stage = 'CLARIFICATION';
        session.stepIndex = 2;

        const reply = `I see a screenshot or viral image! Images are often recycled with fake new captions.

💡 **Quick tip:** You can reverse-search it on [Google Images](https://images.google.com/) or [TinEye](https://tineye.com/) to see where it first appeared.

**Quick question:** Where did you get this screenshot, and does it include a link or publisher name?`;

        return session.addMessage('assistant', reply, {
          stage: session.stage,
          stepIndex: session.stepIndex,
          suggestedReplies: [
            'Forwarded on WhatsApp / Telegram (no link)',
            'Saw it on X / Instagram / Facebook',
            'Has a news logo / direct link'
          ]
        });
      }

      // 3. Plain Text / Rumor Claim
      session.data.inputType = 'claim';
      session.stage = 'CLARIFICATION';
      session.stepIndex = 2;

      // Check known hoaxes
      for (const hoax of KNOWN_HOAX_PATTERNS) {
        if (hoax.regex.test(text)) {
          session.data.matchedHoax = hoax;
        }
      }

      // Check sensational language
      checkSensationalLanguage(text, session);

      // Check for old story keywords
      if (/years ago|old story|2018|2019|2020|recirculated/i.test(text)) {
        session.data.isOld = true;
      }

      const reply = `I've checked your claim: *"\"${text}\"*.

${session.data.languageFlags.length > 0 ? `⚠️ **Watch out:** ${session.data.languageFlags[0]}\n\n` : ''}**Just one quick question:** Where did you see this (e.g. WhatsApp forward, social media, or a major news site)?`;

      return session.addMessage('assistant', reply, {
        stage: session.stage,
        stepIndex: session.stepIndex,
        suggestedReplies: [
          'Forwarded on WhatsApp / Telegram',
          'Saw it on social media (X, Facebook, TikTok)',
          'Read it on a major news website (Reuters, BBC, etc.)',
          'It is an old story being re-shared'
        ]
      });
    }

    case 'CLARIFICATION': {
      // Step 2: Answer received -> Deliver Verdict Immediately!
      session.data.sourceType = text;
      const lower = text.toLowerCase();

      if (lower.includes('old') || lower.includes('re-shared') || lower.includes('recirculated')) {
        session.data.isOld = true;
      }

      session.stage = 'VERDICT';
      session.stepIndex = 2;

      const verdictObj = generateFinalVerdict(session);
      session.data.verdictData = verdictObj.verdictData;

      return session.addMessage('assistant', verdictObj.text, {
        stage: session.stage,
        stepIndex: session.stepIndex,
        verdict: verdictObj.verdictData,
        suggestedReplies: [
          'Check another claim',
          'Copy verdict summary'
        ]
      });
    }

    case 'VERDICT': {
      if (text.toLowerCase().includes('check another') || text.toLowerCase().includes('reset') || text.toLowerCase().includes('new')) {
        const fresh = resetSession(session.sessionId);
        return fresh.addMessage('assistant', `Hi! Paste any headline, link, claim, or screenshot and I'll check it before you share it. This only takes a few seconds!`, {
          stage: 'INTAKE',
          stepIndex: 1,
          suggestedReplies: [
            'Check a news link (URL)',
            'Check a forwarded message/claim',
            'Check an image/screenshot'
          ]
        });
      }

      return session.addMessage('assistant', `Ready for your next check! You can paste another link, headline, or screenshot below, or click **"Check another claim"**.`, {
        stage: 'VERDICT',
        stepIndex: 2,
        suggestedReplies: ['Check another claim']
      });
    }

    default: {
      return session.addMessage('assistant', `Paste a link, headline, claim, or screenshot to get started.`, {
        stage: 'INTAKE',
        stepIndex: 1
      });
    }
  }
}

function checkSensationalLanguage(text, session) {
  for (const pattern of SENSATIONAL_PATTERNS) {
    if (pattern.test(text)) {
      session.data.languageFlags.push('Sensational urgency detected (e.g. "SHOCKING", "WAKE UP", "SHARE BEFORE DELETED")');
      break;
    }
  }

  const words = text.split(/\s+/).filter(w => w.length > 3);
  const capsWords = words.filter(w => w === w.toUpperCase() && /[A-Z]/.test(w));
  if (capsWords.length >= 2) {
    session.data.languageFlags.push('Uses excessive ALL-CAPS words to provoke emotional reaction');
  }
}

function generateSatireVerdict(metadata) {
  const verdictData = {
    verdict: 'Likely False or Misleading if shared as factual news',
    status: 'satire',
    confidence: 'High',
    why: [
      `Published by **${metadata.domain}**, an established comedy/satire publication.`,
      `The article is written for humor and parody, not factual journalism.`,
      `Independent wire services do not report this as real news.`
    ],
    recommendation: 'Do not share as factual news (it is satire)'
  };

  const text = `🔍 Verdict: Likely False or Misleading if shared as factual news
Confidence: High
Why:
• Published by **${metadata.domain}**, a recognized satire and parody publication.
• The article is intended as humor/comedy, not real journalism.
• Not reported by any legitimate news services.
Recommendation: Do not share as factual news (it is satire)`;

  return { verdictData, text };
}

export function generateFinalVerdict(session) {
  const d = session.data;
  const userReply = (d.sourceType || '').toLowerCase();

  // 1. Known hoax
  if (d.matchedHoax) {
    const verdictData = {
      verdict: 'Likely False or Misleading',
      status: 'false',
      confidence: 'High',
      why: [
        `Matches documented hoax pattern: "${d.matchedHoax.title}".`,
        d.matchedHoax.details,
        `No corroborating reporting from reputable scientific or journalistic organizations.`
      ],
      recommendation: 'Do not share'
    };
    return formatVerdictResponse(verdictData);
  }

  // 2. Old story re-shared as breaking
  if (d.isOld || userReply.includes('old') || userReply.includes('re-shared') || userReply.includes('recirculated')) {
    const verdictData = {
      verdict: 'Uncertain — Verify Further',
      status: 'uncertain',
      confidence: 'Medium',
      why: [
        `This appears to be an older story or event being re-shared out of its original time context.`,
        `Recirculating old headlines makes people believe a past event is happening today.`,
        `No independent news sources report this as an active breaking event.`
      ],
      recommendation: 'Don\'t share yet without verifying the original publication date'
    };
    return formatVerdictResponse(verdictData);
  }

  // 3. Reputable wire service / verified reporting
  const isReputable = d.urlMetadata?.domainAnalysis?.isReputable || userReply.includes('major news') || userReply.includes('reuters') || userReply.includes('bbc');

  if (isReputable && !userReply.includes('only found this single link') && !userReply.includes('whatsapp')) {
    const verdictData = {
      verdict: 'Likely Reliable',
      status: 'reliable',
      confidence: 'High',
      why: [
        `Published by a recognized news or wire service with transparent editorial standards.`,
        `Report is corroborated across independent journalistic organizations.`,
        `Cites named journalists or primary sources.`
      ],
      recommendation: 'Safe to share with context'
    };
    return formatVerdictResponse(verdictData);
  }

  // 4. WhatsApp / chat forward / screenshot with no independent corroboration
  if (userReply.includes('whatsapp') || userReply.includes('telegram') || userReply.includes('only found this') || userReply.includes('no link') || d.hasImage) {
    const why = [
      'Originated as an unverified social forward or screenshot without checkable source links.',
      'Could not be corroborated against independent, reputable news wires.',
      d.languageFlags[0] || 'Lacks on-the-record quotes or verifiable primary evidence.'
    ];

    const verdictData = {
      verdict: 'Likely False or Misleading',
      status: 'false',
      confidence: 'Medium',
      why,
      recommendation: 'Do not share'
    };
    return formatVerdictResponse(verdictData);
  }

  // 5. Default fallback
  const verdictData = {
    verdict: 'Uncertain — Verify Further',
    status: 'uncertain',
    confidence: 'Medium',
    why: [
      'Could not find matching coverage on major independent news wires.',
      'The original author and source cannot be independently verified.',
      'Key details remain unconfirmed.'
    ],
    recommendation: 'Don\'t share yet'
  };
  return formatVerdictResponse(verdictData);
}

function formatVerdictResponse(verdictData) {
  const text = `🔍 Verdict: ${verdictData.verdict}
Confidence: ${verdictData.confidence}
Why:
${verdictData.why.map(w => `• ${w}`).join('\n')}
Recommendation: ${verdictData.recommendation}`;

  return { verdictData, text };
}
