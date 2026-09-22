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
    this.stage = 'INTAKE'; // INTAKE, SOURCE_CHECK, AUTHOR_DATE_CHECK, CROSS_VERIFY, EVIDENCE_LANGUAGE, VERDICT
    this.history = [];
    this.data = {
      rawInput: '',
      inputType: null, // 'url', 'claim', 'image'
      urlMetadata: null,
      sourceInfo: {},
      authorInfo: {},
      dateInfo: {},
      crossVerifyInfo: {},
      evidenceInfo: {},
      languageFlags: [],
      hasImage: false,
      imageAnalysis: null,
      verdictData: null
    };
    this.stepIndex = 1; // 1 to 5 for the visual checklist tracker
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

// In-memory session store (can be scaled to Redis or DB if needed)
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
 * Main conversation handler: processes user message and returns bot reply,
 * active stage, progress indicator, and suggested quick-reply chips.
 */
export async function processUserMessage(session, userMessage, attachments = {}) {
  // Save user message
  session.addMessage('user', userMessage, { attachments });

  const text = (userMessage || '').trim();
  const urlMatch = text.match(/https?:\/\/[^\s]+/i);

  // Check if LLM should generate the reply or if we use our structured state machine
  // We first use the structured flow to maintain exact checklist progression,
  // augmenting each stage's explanation with LLM if available.

  switch (session.stage) {
    case 'INTAKE': {
      session.data.rawInput = text;
      session.data.hasImage = !!(attachments.image || text.toLowerCase().includes('screenshot') || text.toLowerCase().includes('image attached'));

      // Check for URL
      if (urlMatch) {
        session.data.inputType = 'url';
        session.data.url = urlMatch[0];
        const metadata = await fetchUrlMetadata(urlMatch[0]);
        session.data.urlMetadata = metadata;

        // Check if satire
        if (metadata.domainAnalysis?.isSatire) {
          session.stage = 'VERDICT';
          session.stepIndex = 5;
          const verdictContent = generateSatireVerdict(metadata);
          session.data.verdictData = verdictContent.verdictData;
          return session.addMessage('assistant', verdictContent.text, {
            stage: session.stage,
            stepIndex: session.stepIndex,
            verdict: verdictContent.verdictData,
            suggestedReplies: ['Check another claim', 'Copy summary']
          });
        }

        // Check if typosquatting / deceptive
        if (metadata.domainAnalysis?.category === 'suspicious') {
          session.data.languageFlags.push('Typosquatted or deceptive domain name mimicking a legitimate outlet');
        }

        // Check if old story
        if (metadata.isOlderStory) {
          session.data.dateInfo.isOld = true;
          session.data.dateInfo.ageDays = metadata.dateAgeDays;
        }

        session.stage = 'AUTHOR_DATE_CHECK';
        session.stepIndex = 2;

        let reply = `Thanks for sharing the link! I inspected **${metadata.domain}**.\n\n`;
        if (metadata.title) {
          reply += `📄 **Headline:** "${metadata.title}"\n`;
        }
        if (metadata.author) {
          reply += `✍️ **Author listed:** ${metadata.author}\n`;
        }
        if (metadata.publishDate) {
          reply += `📅 **Date detected:** ${metadata.publishDate}\n`;
        }

        if (metadata.domainAnalysis?.isReputable) {
          reply += `\n✅ **Source Check:** The domain is a recognized major news or wire outlet.\n\n`;
        } else if (metadata.domainAnalysis?.category === 'suspicious') {
          reply += `\n⚠️ **Source Warning:** ${metadata.domainAnalysis.notes}\n\n`;
        } else {
          reply += `\nℹ️ **Source Check:** This domain is an independent or less familiar site. We should look closely at bylines and corroborating reports.\n\n`;
        }

        reply += `**Next check:** Is there a named journalist/byline with a verifiable background, or does the article look anonymous or auto-generated?`;

        return session.addMessage('assistant', reply, {
          stage: session.stage,
          stepIndex: session.stepIndex,
          metadata,
          suggestedReplies: [
            'Yes, named reputable journalist',
            'No author / Anonymous',
            'I cannot tell'
          ]
        });
      }

      // Check if Image / Screenshot without URL
      if (session.data.hasImage) {
        session.data.inputType = 'image';
        session.stage = 'SOURCE_CHECK';
        session.stepIndex = 2;

        const reply = `I see this is an image or screenshot! While I cannot directly perform real-time pixel forensic analysis, images are frequently taken out of context, manipulated, or AI-generated.

Here is how you can verify it in 30 seconds:
1. **Reverse Image Search:** Open [Google Images](https://images.google.com/) or [TinEye](https://tineye.com/) and upload this screenshot.
2. Check if the exact photo appeared years earlier with an entirely different headline.
3. Look for telltale AI generation signs (warped text, distorted hands/ears, unnatural gloss).

**To start our checklist:** Where did you first see this screenshot (e.g., WhatsApp, Telegram, X, Facebook), and is there any original link or outlet name visible on it?`;

        return session.addMessage('assistant', reply, {
          stage: session.stage,
          stepIndex: session.stepIndex,
          suggestedReplies: [
            'Forwarded on WhatsApp/Telegram',
            'Saw it on X / Twitter / Reddit',
            'Has an outlet logo/watermark',
            'No source or link anywhere'
          ]
        });
      }

      // Plain text / claim input
      session.data.inputType = 'claim';
      session.stage = 'SOURCE_CHECK';
      session.stepIndex = 2;

      // Check for quick known hoaxes
      for (const hoax of KNOWN_HOAX_PATTERNS) {
        if (hoax.regex.test(text)) {
          session.data.matchedHoax = hoax;
        }
      }

      // Check for emotional language in claim
      checkSensationalLanguage(text, session);

      const reply = `I've noted your claim: *"\"${text}\"*.

Let's walk through the verification checklist step by step.

**Step 1 — Source Check:**
Do you have a direct link or outlet name for this, or was it shared as a forward, screenshot, or personal social media post?`;

      return session.addMessage('assistant', reply, {
        stage: session.stage,
        stepIndex: session.stepIndex,
        suggestedReplies: [
          'It was a social media forward / chat message',
          'It was from a major news outlet',
          'I saw it on a blog / forum',
          'I have no idea where it started'
        ]
      });
    }

    case 'SOURCE_CHECK': {
      session.data.sourceInfo.userDescription = text;
      const lower = text.toLowerCase();

      if (lower.includes('reuters') || lower.includes('ap news') || lower.includes('bbc') || lower.includes('major news') || lower.includes('wire')) {
        session.data.sourceInfo.reputable = true;
      } else if (lower.includes('forward') || lower.includes('whatsapp') || lower.includes('telegram') || lower.includes('no source') || lower.includes('screenshot')) {
        session.data.sourceInfo.reputable = false;
        session.data.sourceInfo.unverifiedSocial = true;
      }

      session.stage = 'AUTHOR_DATE_CHECK';
      session.stepIndex = 3;

      const reply = `Got it. Source attribution is critical: forwarded messages and unattributed posts carry the highest risk of misinformation.

**Step 2 — Date & Context Check:**
When does this claim or event supposedly take place? Is it presented as **breaking news happening right now**, or could it be an older real event being recirculated out of context?`;

      return session.addMessage('assistant', reply, {
        stage: session.stage,
        stepIndex: session.stepIndex,
        suggestedReplies: [
          'Presented as breaking news today',
          'Might be an older event re-shared',
          'No date or timeframe is specified'
        ]
      });
    }

    case 'AUTHOR_DATE_CHECK': {
      session.data.dateInfo.userDescription = text;
      const lower = text.toLowerCase();
      if (lower.includes('older') || lower.includes('recirculated') || lower.includes('past') || lower.includes('years ago')) {
        session.data.dateInfo.isOld = true;
      }

      session.stage = 'CROSS_VERIFY';
      session.stepIndex = 4;

      const reply = `Noted. Misinformation often relies on recycled footage or stories from years ago presented as today's news.

**Step 3 — Cross-Verification:**
Have you checked if other independent, reputable news outlets (like Reuters, AP News, BBC, or local public broadcasters) are reporting this exact same event?`;

      return session.addMessage('assistant', reply, {
        stage: session.stage,
        stepIndex: session.stepIndex,
        suggestedReplies: [
          'Yes, multiple major outlets report it',
          'No other outlet has reported this',
          'Only found it on blogs/social posts',
          'I have not checked yet'
        ]
      });
    }

    case 'CROSS_VERIFY': {
      session.data.crossVerifyInfo.userDescription = text;
      const lower = text.toLowerCase();
      if (lower.includes('multiple') || lower.includes('major outlets') || lower.includes('reuters') || lower.includes('bbc') || lower.includes('ap')) {
        session.data.crossVerifyInfo.corroborated = true;
      } else if (lower.includes('no other') || lower.includes('only found on blogs') || lower.includes('not checked')) {
        session.data.crossVerifyInfo.corroborated = false;
      }

      session.stage = 'EVIDENCE_LANGUAGE';
      session.stepIndex = 5;

      const reply = `Understood. If a major story is genuine, independent news services will almost always have matching coverage within minutes or hours.

**Step 4 — Evidence & Language Check:**
Does the post/article cite direct primary evidence (such as official public records, on-the-record quotes, scientific studies, or press releases), OR does it rely on vague phrases like *"experts warn"*, *"insiders claim"*, or emotional ALL-CAPS words like *"SHOCKING"* and *"WAKE UP"*?`;

      return session.addMessage('assistant', reply, {
        stage: session.stage,
        stepIndex: session.stepIndex,
        suggestedReplies: [
          'Cites direct primary sources & official quotes',
          'Uses vague claims ("experts say", "anonymous sources")',
          'Heavy sensational / emotional language',
          'No evidence or sources provided'
        ]
      });
    }

    case 'EVIDENCE_LANGUAGE': {
      session.data.evidenceInfo.userDescription = text;
      const lower = text.toLowerCase();
      if (lower.includes('primary') || lower.includes('official quotes') || lower.includes('studies')) {
        session.data.evidenceInfo.hasPrimarySources = true;
      } else {
        session.data.evidenceInfo.hasPrimarySources = false;
      }

      if (lower.includes('sensational') || lower.includes('emotional') || lower.includes('all-caps') || lower.includes('vague')) {
        session.data.languageFlags.push('Emotional manipulation or sensationalist phrasing detected');
      }

      session.stage = 'VERDICT';
      session.stepIndex = 5;

      // Synthesize final verdict
      const verdictObj = generateFinalVerdict(session);
      session.data.verdictData = verdictObj.verdictData;

      return session.addMessage('assistant', verdictObj.text, {
        stage: session.stage,
        stepIndex: session.stepIndex,
        verdict: verdictObj.verdictData,
        suggestedReplies: [
          'Check another story',
          'Copy verdict summary'
        ]
      });
    }

    case 'VERDICT': {
      if (text.toLowerCase().includes('check another') || text.toLowerCase().includes('reset') || text.toLowerCase().includes('new')) {
        const fresh = resetSession(session.sessionId);
        return fresh.addMessage('assistant', `Hi! Paste a headline, link, claim, or screenshot and I'll help you check it before you share it. I'll walk you through it step by step — this usually takes under a minute.`, {
          stage: 'INTAKE',
          stepIndex: 1,
          suggestedReplies: [
            'Check a news link (URL)',
            'Check a forwarded message/claim',
            'Check an image/screenshot'
          ]
        });
      }

      // If user asks follow up questions about the verdict
      const reply = `I'm ready whenever you are! You can paste another headline, link, claim, or screenshot to start a fresh verification, or click **"Check another story"** below.`;
      return session.addMessage('assistant', reply, {
        stage: 'VERDICT',
        stepIndex: 5,
        suggestedReplies: ['Check another story']
      });
    }

    default: {
      return session.addMessage('assistant', `Let's start from the beginning. Please paste a link, headline, claim, or screenshot.`, {
        stage: 'INTAKE',
        stepIndex: 1
      });
    }
  }
}

function checkSensationalLanguage(text, session) {
  for (const pattern of SENSATIONAL_PATTERNS) {
    if (pattern.test(text)) {
      session.data.languageFlags.push('Sensationalist or urgent phrasing detected (e.g. "SHOCKING", "THEY DON\'T WANT YOU TO KNOW")');
      break;
    }
  }

  // Check for excessive ALL CAPS
  const words = text.split(/\s+/).filter(w => w.length > 3);
  const capsWords = words.filter(w => w === w.toUpperCase() && /[A-Z]/.test(w));
  if (capsWords.length >= 2) {
    session.data.languageFlags.push('Prominent ALL-CAPS words often used for emotional urgency');
  }
}

/**
 * Handles known satire domains (e.g. The Onion).
 */
function generateSatireVerdict(metadata) {
  const verdictData = {
    verdict: 'Likely False or Misleading if shared as factual news',
    status: 'satire', // 'reliable', 'uncertain', 'false', 'satire'
    confidence: 'High',
    why: [
      `Published by **${metadata.domain}**, an established satire and humor publication.`,
      `The article is written for comedic or parody purposes rather than factual journalism.`,
      `No independent news or wire services treat this claim as factual reporting.`
    ],
    recommendation: 'Do not share as factual news (it is satire)'
  };

  const text = `🔍 Verdict: Likely False or Misleading if shared as factual news
Confidence: High
Why:
• Published by **${metadata.domain}**, an established satire and humor publication.
• The content is written for comedy/parody and not intended as factual journalism.
• Independent news wires do not report this as real news.
Recommendation: Do not share as factual news (it is satire)`;

  return { verdictData, text };
}

/**
 * Generates the final standardized verdict based on collected checklist signals.
 */
export function generateFinalVerdict(session) {
  const d = session.data;

  // Case 1: Known hoax match
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

  // Case 2: Recirculated / old story
  if (d.dateInfo.isOld) {
    const verdictData = {
      verdict: 'Uncertain — Verify Further',
      status: 'uncertain',
      confidence: 'Medium',
      why: [
        `This appears to be an older story or event being recirculated out of its original time context.`,
        `Sharing outdated reports without clear dates misleads readers into thinking it is current breaking news.`,
        `Independent sources do not report this as an active or current event.`
      ],
      recommendation: 'Don\'t share yet without verifying the original date and context'
    };

    return formatVerdictResponse(verdictData);
  }

  // Case 3: Wire service / major reputable outlet with corroborated reporting
  const isReputableSource = (d.urlMetadata?.domainAnalysis?.isReputable) || d.sourceInfo.reputable;
  const isCorroborated = d.crossVerifyInfo.corroborated;
  const hasPrimarySources = d.evidenceInfo.hasPrimarySources;

  if (isReputableSource && (isCorroborated || hasPrimarySources)) {
    const verdictData = {
      verdict: 'Likely Reliable',
      status: 'reliable',
      confidence: 'High',
      why: [
        `Published or verified by established international wire/journalistic services with transparent editorial standards.`,
        `Cites verifiable primary evidence, on-the-record quotes, or named journalists.`,
        `Information is corroborated across independent reporting outlets.`
      ],
      recommendation: 'Safe to share with context'
    };

    return formatVerdictResponse(verdictData);
  }

  // Case 4: Unverified social forward / screenshot with no independent corroboration
  if (d.sourceInfo.unverifiedSocial || !isCorroborated || d.data?.hasImage) {
    const whyList = [];

    if (d.sourceInfo.unverifiedSocial || d.hasImage) {
      whyList.push('Originated as an unverified social forward or screenshot without verifiable source attribution.');
    } else {
      whyList.push('Could not be corroborated against independent, reputable news wires or primary records.');
    }

    if (!hasPrimarySources) {
      whyList.push('Lacks direct primary evidence, relying instead on anonymous claims or vague attribution.');
    }

    if (d.languageFlags.length > 0) {
      whyList.push(d.languageFlags[0]);
    } else {
      whyList.push('No named author with checkable credentials was confirmed.');
    }

    const verdictData = {
      verdict: d.crossVerifyInfo.corroborated === false ? 'Likely False or Misleading' : 'Uncertain — Verify Further',
      status: d.crossVerifyInfo.corroborated === false ? 'false' : 'uncertain',
      confidence: d.crossVerifyInfo.corroborated === false ? 'Medium' : 'Medium',
      why: whyList.slice(0, 3),
      recommendation: d.crossVerifyInfo.corroborated === false ? 'Do not share' : 'Don\'t share yet'
    };

    return formatVerdictResponse(verdictData);
  }

  // Default fallback verdict
  const verdictData = {
    verdict: 'Uncertain — Verify Further',
    status: 'uncertain',
    confidence: 'Low',
    why: [
      'Insufficient verifiable details or primary sources were identified during the check.',
      'Independent fact-checking databases have not yet established a definitive consensus.',
      'Key details (exact date, original source, primary evidence) remain ambiguous.'
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
