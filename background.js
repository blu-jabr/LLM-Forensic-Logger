console.log("[Forensic Logger] New background.js loaded successfully.");

const sessionState = {};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'LOG_LLM_ROUND') {
    logRound(message.payload, sender.tab.id);
    sendResponse({ status: 'success' });
  } else if (message.type === 'BULK_LOG_SESSION') {
    const rounds = message.payload;
    rounds.forEach((roundData, index) => {
      setTimeout(() => {
        const payload = {
          prompt: roundData.prompt,
          thinking: roundData.thinking || "",
          response: roundData.response,
          mediaFiles: roundData.mediaFiles || [],
          generationDurationMs: 0,
          domNodeCount: 0,
          origin: sender.tab ? sender.tab.url : 'unknown'
        };
        logRound(payload, sender.tab.id);
      }, index * 500); // 500ms delay per round to allow media downloads to process
    });
    sendResponse({ status: 'success' });
  }
  return true;
});

async function logRound(payload, tabId) {
  if (!sessionState[tabId]) {
    sessionState[tabId] = { SESSION_ID: crypto.randomUUID(), round_number: 0 };
  }

  const state = sessionState[tabId];
  state.round_number += 1;
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

  // Replace the placeholder in the markdown with the actual directory name
  const finalPrompt = payload.prompt.replace(/flush\.MEDIA_PLACEHOLDER/g, mediaDirName);
  const finalThinking = payload.thinking.replace(/flush\.MEDIA_PLACEHOLDER/g, mediaDirName);
  const finalResponse = payload.response.replace(/flush\.MEDIA_PLACEHOLDER/g, mediaDirName);

  // 1. Create Markdown content
  const mdContent = createMarkdown(finalPrompt, finalThinking, finalResponse, state.SESSION_ID, roundNum);
  const mdUrl = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(mdContent);

  // 2. Create JSON Metadata content
  const jsonContent = createJsonMetadata(payload, state.SESSION_ID, roundNum, dateStr, timeStr, HOSTNAME);
  const jsonUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(jsonContent, null, 2));

  // Trigger Downloads for MD and JSON
  chrome.downloads.download({ url: mdUrl, filename: `${folderPath}${baseFilename}.md`, saveAs: false });
  chrome.downloads.download({ url: jsonUrl, filename: `${folderPath}${baseFilename}.json`, saveAs: false });

  // 3. Trigger Downloads for Media Files
  if (payload.mediaFiles && payload.mediaFiles.length > 0) {
    payload.mediaFiles.forEach((media, idx) => {
      setTimeout(() => {
        // Use directUrl if available (bypasses page CSP), otherwise use dataUrl (for blobs)
        const downloadUrl = media.directUrl || media.dataUrl;
        
        if (downloadUrl) {
          chrome.downloads.download({
            url: downloadUrl,
            filename: `${folderPath}${mediaDirName}/${media.filename}`,
            saveAs: false
          });
        }
      }, idx * 200); // Stagger media downloads by 200ms
    });
  }
}

function createMarkdown(prompt, thinking, response, sessionId, roundNum) {
  let md = `# AI Forensic Log\n\n`;
  md += `**Session ID:** ${sessionId}\n`;
  md += `**Round:** ${roundNum}\n\n`;
  md += `## User Prompt\n\n${prompt}\n\n`;
  if (thinking && thinking.trim().length > 0) {
    md += `## AI Thinking\n\n\`\`\`\n${thinking}\n\`\`\`\n\n`;
  }
  md += `## AI Response\n\n${response}\n`;
  return md;
}

function createJsonMetadata(payload, sessionId, roundNum, dateStr, timeStr, hostname) {
  const responseWords = payload.response.split(/\s+/).length;
  const promptWords = payload.prompt.split(/\s+/).length;
  const hedgingWords = (payload.response.match(/\b(might be|could be|possibly|perhaps|assuming|I think|likely)\b/gi) || []).length;
  const selfCorrections = (payload.response.match(/\b(Actually|Wait|Correction|I apologize|I made a mistake)\b/gi) || []).length;

  return {
    session_id: sessionId,
    round_number: roundNum,
    timestamp_utc: new Date().toISOString(),
    hostname: hostname,
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
