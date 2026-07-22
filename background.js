console.log("[Forensic Logger] New background.js loaded successfully.");

let isProcessing = false;
const logQueue = [];

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'LOG_LLM_ROUND') {
    logQueue.push({ payload: message.payload, isBulk: false });
    processQueue();
    sendResponse({ status: 'success' });
  } else if (message.type === 'BULK_LOG_SESSION') {
    const { rounds, sessionName, chatId } = message.payload;
    console.log(`[Forensic Logger] Background received bulk request for ${rounds.length} rounds.`);
    
    // ADD THIS: Reset the sequence number for this chat to 0 before queueing
    if (chatId) {
      getSessionState(chatId, true).then(() => {
        rounds.forEach((roundData) => {
          const payload = {
            prompt: roundData.prompt,
            thinking: roundData.thinking || "",
            response: roundData.response,
            mediaFiles: roundData.mediaFiles || [],
            roundHtml: roundData.roundHtml || "",
            sessionName: sessionName || "Untitled Session",
            metadata: roundData.metadata || {},
            chatId: chatId, // Pass chatId in payload
            generationDurationMs: 0,
            domNodeCount: 0,
            origin: sender.tab ? sender.tab.url : 'unknown'
          };
          logQueue.push({ payload, isBulk: true });
        });
        processQueue();
      });
    }
    sendResponse({ status: 'success' });
  }
  return true;
});

async function processQueue() {
  if (isProcessing || logQueue.length === 0) return;
  isProcessing = true;

  const { payload } = logQueue.shift();
  await logRound(payload, payload.chatId);

  isProcessing = false;
  if (logQueue.length > 0) setTimeout(processQueue, 100);
}

// UPDATED: Added shouldReset parameter
async function getSessionState(chatId, shouldReset = false) {
  const data = await chrome.storage.local.get(['sessions']);
  const sessions = data.sessions || {};
  
  if (!sessions[chatId] || shouldReset) {
    // Generate a NEW Session ID and reset the round number to 0
    sessions[chatId] = { SESSION_ID: crypto.randomUUID(), round_number: 0 };
    await chrome.storage.local.set({ sessions });
  }
  
  return sessions[chatId];
}

async function saveSessionState(chatId, state) {
  const data = await chrome.storage.local.get(['sessions']);
  const sessions = data.sessions || {};
  sessions[chatId] = state;
  await chrome.storage.local.set({ sessions });
}

async function logRound(payload, chatId) {
  const state = await getSessionState(chatId);
  state.round_number += 1;
  await saveSessionState(chatId, state);

  const roundNum = state.round_number;
  const seqNum = String(roundNum).padStart(8, '0');

  const { hostname } = await chrome.storage.local.get(['hostname']);
  const HOSTNAME = hostname || 'unknown-host';

  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const timeStr = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;

  const baseFilename = `flush.${state.SESSION_ID}.${dateStr}.${timeStr}.${HOSTNAME}.${seqNum}`;
  const folderPath = `LLM-Forensic-Logger/${dateStr}/`;
  const mediaDirName = `${baseFilename}.d`;

  const mdContentRaw = createMarkdown(payload, state.SESSION_ID, roundNum);
  const mdContent = mdContentRaw.replace(/flush\.MEDIA_PLACEHOLDER/g, mediaDirName);
  const mdUrl = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(mdContent);

  const jsonContent = createJsonMetadata(payload, state.SESSION_ID, roundNum, dateStr, timeStr, HOSTNAME);
  const jsonUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(jsonContent, null, 2));

  const xhtmlContent = `<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="UTF-8"/><title>Round ${roundNum}</title></head><body>${payload.roundHtml || ""}</body></html>`;
  const finalXhtmlContent = xhtmlContent.replace(/flush\.MEDIA_PLACEHOLDER/g, mediaDirName);
  const xhtmlUrl = 'data:application/xhtml+xml;charset=utf-8,' + encodeURIComponent(finalXhtmlContent);

  chrome.downloads.download({ url: mdUrl, filename: `${folderPath}${baseFilename}.md`, saveAs: false });
  chrome.downloads.download({ url: jsonUrl, filename: `${folderPath}${baseFilename}.json`, saveAs: false });
  chrome.downloads.download({ url: xhtmlUrl, filename: `${folderPath}${baseFilename}.xhtml`, saveAs: false });

  if (payload.mediaFiles && payload.mediaFiles.length > 0) {
    payload.mediaFiles.forEach((media, idx) => {
      setTimeout(() => {
        const downloadUrl = media.directUrl || media.dataUrl;
        if (downloadUrl) {
          chrome.downloads.download({
            url: downloadUrl,
            filename: `${folderPath}${mediaDirName}/${media.filename}`,
            saveAs: false
          });
        }
      }, idx * 200);
    });
  }
}

function createMarkdown(payload, sessionId, roundNum) {
  let md = `# AI Forensic Log\n\n`;
  md += `**Session ID:** ${sessionId}\n`;
  if (payload.sessionName) md += `**Session Name:** ${payload.sessionName}\n`;
  md += `**Round:** ${roundNum}\n`;
  md += `\n## User Prompt\n\n${payload.prompt}\n\n`;

  if (payload.thinking && payload.thinking.trim().length > 0) {
    md += `## AI Thinking\n\n\`\`\`\n${payload.thinking}\n\`\`\`\n\n`;
  }
  md += `## AI Response\n\n${payload.response}\n`;
  return md;
}

function createJsonMetadata(payload, sessionId, roundNum, dateStr, timeStr, hostname) {
  const responseWords = payload.response.split(/\s+/).length;
  const promptWords = payload.prompt.split(/\s+/).length;
  const hedgingWords = (payload.response.match(/\b(might be|could be|possibly|perhaps|assuming|I think|likely)\b/gi) || []).length;
  const selfCorrections = (payload.response.match(/\b(Actually|Wait|Correction|I apologize|I made a mistake)\b/gi) || []).length;

  return {
    session_id: sessionId,
    session_name: payload.sessionName || null,
    round_number: roundNum,
    timestamp_logged_utc: new Date().toISOString(),
    hostname: hostname,
    gemini_metadata: payload.metadata || {},
    metrics: {
      resource_usage: {
        prompt_char_length: payload.prompt.length,
        response_char_length: payload.response.length,
        thinking_char_length: payload.thinking ? payload.thinking.length : 0,
        prompt_word_count: promptWords,
        response_word_count: responseWords,
        generation_duration_ms: payload.generationDurationMs,
        dom_node_count_at_log: payload.domNodeCount,
        media_files_logged: payload.mediaFiles ? payload.mediaFiles.length : 0
      },
      drift_and_hallucination_indicators: {
        hedging_language_count: hedgingWords,
        self_correction_count: selfCorrections,
        lexical_diversity: calculateLexicalDiversity(payload.response)
      }
    },
    system_info: { url_origin: payload.origin }
  };
}

function calculateLexicalDiversity(text) {
  const words = text.toLowerCase().match(/\b(\w+)\b/g) || [];
  if (words.length === 0) return 0;
  return new Set(words).size / words.length;
}
