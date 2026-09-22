/**
 * Fake News Checker - Frontend Application
 */

const state = {
  sessionId: 'session-' + Math.random().toString(36).substring(2, 9),
  currentStep: 1,
  attachedImage: null, // { dataUrl, name }
  isTyping: false
};

// DOM Elements
const chatMessages = document.getElementById('chatMessages');
const chatForm = document.getElementById('chatForm');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const quickRepliesContainer = document.getElementById('quickRepliesContainer');
const resetSessionBtn = document.getElementById('resetSessionBtn');
const testCasesBtn = document.getElementById('testCasesBtn');
const testCasesDrawer = document.getElementById('testCasesDrawer');
const closeDrawerBtn = document.getElementById('closeDrawerBtn');
const testChipsContainer = document.getElementById('testChipsContainer');
const imageFileInput = document.getElementById('imageFileInput');
const attachmentPreview = document.getElementById('attachmentPreview');
const previewImg = document.getElementById('previewImg');
const previewFileName = document.getElementById('previewFileName');
const removeAttachmentBtn = document.getElementById('removeAttachmentBtn');
const stepCounter = document.getElementById('stepCounter');
const toastEl = document.getElementById('toast');

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  loadTestCases();
  sendInitialGreeting();
});

function setupEventListeners() {
  // Chat form submit
  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    handleSubmitMessage();
  });

  // Textarea auto-expansion & Enter key handler
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmitMessage();
    }
  });

  messageInput.addEventListener('input', () => {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 140) + 'px';
  });

  // Paste handler to capture pasted screenshots directly!
  messageInput.addEventListener('paste', handleClipboardPaste);

  // File input change
  imageFileInput.addEventListener('change', handleFileSelect);

  // Remove attachment button
  removeAttachmentBtn.addEventListener('click', clearAttachment);

  // Reset button
  resetSessionBtn.addEventListener('click', resetConversation);

  // Test cases drawer toggle
  testCasesBtn.addEventListener('click', () => {
    testCasesDrawer.classList.toggle('open');
  });

  closeDrawerBtn.addEventListener('click', () => {
    testCasesDrawer.classList.remove('open');
  });
}

/**
 * Handle pasted images directly from clipboard (e.g. Snipping tool / PrtScn)
 */
function handleClipboardPaste(e) {
  const items = (e.clipboardData || e.originalEvent.clipboardData).items;
  for (const item of items) {
    if (item.type.indexOf('image') === 0) {
      const blob = item.getAsFile();
      const reader = new FileReader();
      reader.onload = (event) => {
        setAttachment(event.target.result, 'Pasted screenshot');
        showToast('Screenshot attached from clipboard!');
      };
      reader.readAsDataURL(blob);
      break;
    }
  }
}

/**
 * Handle file input selection
 */
function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    setAttachment(event.target.result, file.name);
    showToast('Image attached!');
  };
  reader.readAsDataURL(file);
}

function setAttachment(dataUrl, name) {
  state.attachedImage = { dataUrl, name };
  previewImg.src = dataUrl;
  previewFileName.textContent = name;
  attachmentPreview.style.display = 'flex';
}

function clearAttachment() {
  state.attachedImage = null;
  previewImg.src = '';
  attachmentPreview.style.display = 'none';
  imageFileInput.value = '';
}

/**
 * Sends the opening system greeting
 */
function sendInitialGreeting() {
  const openingText = "Hi! Paste a headline, link, claim, or screenshot and I'll help you check it before you share it. I'll walk you through it step by step — this usually takes under a minute.";
  
  appendMessage({
    role: 'assistant',
    content: openingText,
    suggestedReplies: [
      'Check a news link (URL)',
      'Check a forwarded message/claim',
      'Check an image/screenshot'
    ]
  });
  updateStepIndicator(1);
}

/**
 * Submits user message to the backend
 */
async function handleSubmitMessage(overrideText = null) {
  const text = (overrideText !== null ? overrideText : messageInput.value).trim();
  const attachment = state.attachedImage;

  if (!text && !attachment) return;

  // Clear inputs
  messageInput.value = '';
  messageInput.style.height = 'auto';
  clearAttachment();
  quickRepliesContainer.innerHTML = '';

  // Render user message bubble
  appendMessage({
    role: 'user',
    content: text,
    image: attachment ? attachment.dataUrl : null
  });

  // Show typing indicator
  const typingIndicator = showTypingIndicator();
  sendBtn.disabled = true;

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: state.sessionId,
        message: text,
        attachments: attachment ? { image: attachment.dataUrl } : {}
      })
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }

    const data = await response.json();
    removeTypingIndicator(typingIndicator);

    if (data.stepIndex) {
      updateStepIndicator(data.stepIndex);
    }

    appendMessage(data.reply);
  } catch (err) {
    removeTypingIndicator(typingIndicator);
    console.error('Chat error:', err);
    appendMessage({
      role: 'assistant',
      content: '⚠️ I encountered an error communicating with the server. Please try again or click **Check Another** to restart.'
    });
  } finally {
    sendBtn.disabled = false;
  }
}

/**
 * Appends a message to the chat view
 */
function appendMessage(msg) {
  const msgDiv = document.createElement('div');
  msgDiv.className = `chat-message ${msg.role}`;

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = msg.role === 'user' ? 'You' : 'FN';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';

  // Render attached image if present
  if (msg.image || (msg.attachments && msg.attachments.image)) {
    const imgEl = document.createElement('img');
    imgEl.src = msg.image || msg.attachments.image;
    imgEl.className = 'chat-img-attachment';
    imgEl.alt = 'Attached screenshot';
    bubble.appendChild(imgEl);
  }

  // Format content (basic markdown formatting)
  const formattedHtml = formatContent(msg.content);
  const textContainer = document.createElement('div');
  textContainer.innerHTML = formattedHtml;
  bubble.appendChild(textContainer);

  // Render verdict card if present
  if (msg.verdict) {
    const verdictCard = renderVerdictCard(msg.verdict);
    bubble.appendChild(verdictCard);
  }

  msgDiv.appendChild(avatar);
  msgDiv.appendChild(bubble);
  chatMessages.appendChild(msgDiv);

  // Scroll to bottom
  chatMessages.scrollTop = chatMessages.scrollHeight;

  // Render suggested quick replies
  renderQuickReplies(msg.suggestedReplies);
}

/**
 * Renders the formatted verdict card component
 */
function renderVerdictCard(verdict) {
  const card = document.createElement('div');
  const statusClass = verdict.status || 'uncertain';
  card.className = `verdict-card ${statusClass}`;

  const reasonsHtml = verdict.why.map(w => `<li>${w}</li>`).join('');

  card.innerHTML = `
    <div class="verdict-card-header">
      <div class="verdict-badge">🔍 ${verdict.verdict}</div>
      <div class="confidence-pill">Confidence: ${verdict.confidence}</div>
    </div>
    <div class="verdict-reasons-title">Why:</div>
    <ul class="verdict-reasons-list">
      ${reasonsHtml}
    </ul>
    <div class="verdict-recommendation">
      <strong>Recommendation:</strong> ${verdict.recommendation}
    </div>
    <div class="verdict-actions">
      <button type="button" class="btn btn-secondary btn-sm copy-verdict-btn">
        📋 Copy Summary
      </button>
      <button type="button" class="btn btn-primary btn-sm reset-flow-btn">
        🔄 Check Another Claim
      </button>
    </div>
  `;

  // Attach button events
  const copyBtn = card.querySelector('.copy-verdict-btn');
  copyBtn.addEventListener('click', () => {
    const summaryText = `🔍 Verdict: ${verdict.verdict}
Confidence: ${verdict.confidence}
Why:
${verdict.why.map(w => `• ${w}`).join('\n')}
Recommendation: ${verdict.recommendation}

Checked via Fake News Checker`;
    navigator.clipboard.writeText(summaryText);
    showToast('Verdict summary copied to clipboard!');
  });

  const resetBtn = card.querySelector('.reset-flow-btn');
  resetBtn.addEventListener('click', resetConversation);

  return card;
}

/**
 * Formats Markdown bold, italic, lists, and links
 */
function formatContent(text) {
  if (!text) return '';

  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\[(.*?)\]\((https?:\/\/.*?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');
}

/**
 * Renders quick reply buttons
 */
function renderQuickReplies(replies) {
  quickRepliesContainer.innerHTML = '';
  if (!replies || !replies.length) return;

  for (const reply of replies) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'reply-pill';
    btn.textContent = reply;
    btn.addEventListener('click', () => {
      if (reply === 'Check another claim' || reply === 'Check another story') {
        resetConversation();
      } else if (reply === 'Copy summary') {
        const lastVerdict = document.querySelector('.copy-verdict-btn');
        if (lastVerdict) lastVerdict.click();
      } else {
        handleSubmitMessage(reply);
      }
    });
    quickRepliesContainer.appendChild(btn);
  }
}

/**
 * Updates the 5-step checklist tracker in the sidebar
 */
function updateStepIndicator(stepIndex) {
  state.currentStep = stepIndex;
  stepCounter.textContent = `Step ${stepIndex} of 5`;

  const steps = document.querySelectorAll('.step-item');
  steps.forEach((step, idx) => {
    const stepNum = idx + 1;
    step.classList.remove('active', 'completed');
    if (stepNum < stepIndex) {
      step.classList.add('completed');
    } else if (stepNum === stepIndex) {
      step.classList.add('active');
    }
  });
}

function showTypingIndicator() {
  const typingDiv = document.createElement('div');
  typingDiv.className = 'chat-message assistant typing-indicator';
  typingDiv.innerHTML = `
    <div class="message-avatar">FN</div>
    <div class="message-bubble" style="padding: 10px 16px; color: var(--text-muted); font-style: italic;">
      Analyzing verification checklist...
    </div>
  `;
  chatMessages.appendChild(typingDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return typingDiv;
}

function removeTypingIndicator(indicator) {
  if (indicator && indicator.parentNode) {
    indicator.parentNode.removeChild(indicator);
  }
}

/**
 * Resets the session
 */
async function resetConversation() {
  try {
    const response = await fetch('/api/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: state.sessionId })
    });
    const data = await response.json();

    chatMessages.innerHTML = '';
    quickRepliesContainer.innerHTML = '';
    clearAttachment();
    updateStepIndicator(1);
    appendMessage(data.reply);
    showToast('Started a fresh verification session');
  } catch (err) {
    console.error('Reset error:', err);
  }
}

/**
 * Loads test cases from the server and populates the test cases drawer
 */
async function loadTestCases() {
  try {
    const response = await fetch('/api/test-cases');
    const data = await response.json();

    testChipsContainer.innerHTML = '';
    data.testCases.forEach((tc) => {
      const chip = document.createElement('div');
      chip.className = 'test-chip';
      chip.innerHTML = `
        <span class="test-chip-label">${tc.label}</span>
        <span class="test-chip-desc">${tc.description} &bull; <em>${tc.expected}</em></span>
      `;
      chip.addEventListener('click', () => {
        testCasesDrawer.classList.remove('open');
        handleSubmitMessage(tc.input);
      });
      testChipsContainer.appendChild(chip);
    });
  } catch (err) {
    console.error('Could not load test cases:', err);
  }
}

function showToast(text) {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  setTimeout(() => {
    toastEl.classList.remove('show');
  }, 2800);
}
