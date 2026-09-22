import express from 'express';
import { getOrCreateSession, resetSession, processUserMessage } from '../services/verificationEngine.js';
import { fetchUrlMetadata } from '../services/urlMetadata.js';

const router = express.Router();

// Pre-configured test cases matching Section 8 of the build specification
const TEST_CASES = [
  {
    id: 'wire-service',
    label: '📰 Wire Article (Reuters/AP)',
    description: 'Link to a well-known wire service report',
    type: 'url',
    input: 'https://www.reuters.com/world/un-general-assembly-approves-resolution-2024-09-18/',
    expected: 'Likely Reliable (High confidence)'
  },
  {
    id: 'known-hoax',
    label: '🛸 Known Hoax (Moon Landing)',
    description: 'Past debunked conspiracy claim',
    type: 'claim',
    input: 'Breaking: Leaked NASA papers prove the moon landing was cancelled and filmed in a desert studio! Share before deleted!',
    expected: 'Likely False (High confidence)'
  },
  {
    id: 'satire-site',
    label: '🧅 Satire Article (The Onion)',
    description: 'Satire presented as real news',
    type: 'url',
    input: 'https://theonion.com/study-finds-americans-now-get-majority-of-nutrients-from-food-dropped-on-floor/',
    expected: 'Flagged as Satire (Not factual)'
  },
  {
    id: 'old-story',
    label: '⏳ Recirculated Story',
    description: 'Real news from years ago re-shared as breaking',
    type: 'claim',
    input: 'URGENT: Massive airport power outage halts all international flights right now! Is this happening today?',
    expected: 'Uncertain — verify publication date'
  },
  {
    id: 'screenshot',
    label: '📱 Screenshot Claim',
    description: 'Image with no source or date',
    type: 'image',
    input: 'Someone forwarded me this screenshot claiming banks are freezing private accounts starting tomorrow. No link attached.',
    expected: 'Clarifying questions & reverse-image search'
  }
];

// POST /api/chat - Main conversational endpoint
router.post('/chat', async (req, res) => {
  try {
    const { sessionId = 'default-session', message, attachments = {} } = req.body;

    if (!message && !attachments.image) {
      return res.status(400).json({ error: 'Message or attachment is required.' });
    }

    const session = getOrCreateSession(sessionId);
    const botReply = await processUserMessage(session, message, attachments);

    res.json({
      reply: botReply,
      stage: session.stage,
      stepIndex: session.stepIndex,
      data: session.data
    });
  } catch (err) {
    console.error('Error in /api/chat:', err);
    res.status(500).json({ error: 'Internal server error processing message.' });
  }
});

// POST /api/fetch-url - Inspect URL metadata directly
router.post('/fetch-url', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'URL parameter is required.' });
    }

    const metadata = await fetchUrlMetadata(url);
    res.json(metadata);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to fetch URL metadata.' });
  }
});

// POST /api/reset - Restart checklist session
router.post('/reset', (req, res) => {
  const { sessionId = 'default-session' } = req.body;
  const session = resetSession(sessionId);

  const initialMessage = session.addMessage(
    'assistant',
    "Hi! Paste a headline, link, claim, or screenshot and I'll help you check it before you share it. I'll walk you through it step by step — this usually takes under a minute.",
    {
      stage: 'INTAKE',
      stepIndex: 1,
      suggestedReplies: [
        'Check a news link (URL)',
        'Check a forwarded message/claim',
        'Check an image or screenshot'
      ]
    }
  );

  res.json({
    message: 'Session reset successfully',
    reply: initialMessage,
    stage: session.stage,
    stepIndex: session.stepIndex
  });
});

// GET /api/test-cases - Retrieve pre-configured scenarios
router.get('/test-cases', (req, res) => {
  res.json({ testCases: TEST_CASES });
});

export default router;
