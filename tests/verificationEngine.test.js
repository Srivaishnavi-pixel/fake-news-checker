import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VerificationSession,
  processUserMessage,
  generateFinalVerdict
} from '../server/services/verificationEngine.js';

test('Spec Test Case 1: Wire-service article (Reuters/AP) flow leads to Likely Reliable in 2 quick steps', async () => {
  const session = new VerificationSession('test-case-1');
  
  // Step 1: Intake URL
  const reply1 = await processUserMessage(session, 'https://www.reuters.com/world/un-assembly-vote');
  assert.equal(session.stepIndex, 2);
  assert.equal(session.data.inputType, 'url');

  // Step 2: Answer quick question -> Immediate verdict!
  const replyFinal = await processUserMessage(session, 'Yes, multiple major news sites report it');
  assert.equal(session.stage, 'VERDICT');
  assert.ok(replyFinal.verdict);
  assert.equal(replyFinal.verdict.status, 'reliable');
  assert.equal(replyFinal.verdict.confidence, 'High');
  assert.match(replyFinal.verdict.verdict, /Likely Reliable/i);
  assert.match(replyFinal.verdict.recommendation, /Safe to share/i);
});

test('Spec Test Case 2: Well-known hoax (Moon landing cancelled) leads to Likely False', async () => {
  const session = new VerificationSession('test-case-2');

  // Step 1: Intake claim
  await processUserMessage(session, 'Breaking: Leaked NASA papers prove the moon landing was cancelled and filmed in a desert studio!');
  assert.equal(session.stepIndex, 2);
  assert.ok(session.data.matchedHoax, 'Should recognize documented moon landing conspiracy');

  // Step 2: Answer quick question -> Immediate verdict!
  const replyFinal = await processUserMessage(session, 'Forwarded on WhatsApp / Telegram');
  assert.equal(session.stage, 'VERDICT');
  assert.ok(replyFinal.verdict);
  assert.equal(replyFinal.verdict.status, 'false');
  assert.match(replyFinal.verdict.verdict, /Likely False/i);
  assert.match(replyFinal.verdict.recommendation, /Do not share/i);
});

test('Spec Test Case 3: Satire site article (The Onion) flagged immediately as satire', async () => {
  const session = new VerificationSession('test-case-3');

  const reply = await processUserMessage(session, 'https://theonion.com/study-finds-americans-drop-food');
  assert.equal(session.stage, 'VERDICT');
  assert.ok(reply.verdict);
  assert.equal(reply.verdict.status, 'satire');
  assert.match(reply.verdict.verdict, /Likely False or Misleading/i);
  assert.match(reply.verdict.recommendation, /satire/i);
});

test('Spec Test Case 4: Old real story recirculated leads to Uncertain / Recirculated flag', async () => {
  const session = new VerificationSession('test-case-4');

  await processUserMessage(session, 'Massive airport power outage halts all international flights right now!');
  const replyFinal = await processUserMessage(session, 'It is an old story being re-shared');

  assert.equal(session.stage, 'VERDICT');
  assert.ok(replyFinal.verdict);
  assert.equal(replyFinal.verdict.status, 'uncertain');
  assert.match(replyFinal.verdict.verdict, /Uncertain/i);
  assert.match(replyFinal.verdict.recommendation, /Don't share yet/i);
});

test('Spec Test Case 5: Screenshot input prompts reverse-image search guidance', async () => {
  const session = new VerificationSession('test-case-5');

  const reply = await processUserMessage(session, 'I have a screenshot claiming banks are freezing accounts', {
    image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  });

  assert.equal(session.data.inputType, 'image');
  assert.equal(session.stepIndex, 2);
  assert.match(reply.content, /reverse-search/i);
  assert.match(reply.content, /Google Images/i);
  assert.match(reply.content, /TinEye/i);
});
