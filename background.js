// Keep track of sessions and sequence numbers in memory
const sessionState = {};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'LOG_LLM_ROUND') {
    logRound(message.payload, sender.tab.id);
    sendResponse({ status: 'success' });
  }
  return true;
});

async function logRound(payload, tabId) {
  // Initialize session if it doesn't exist
  if (!sessionState[tabId]) {
    sessionState[tabId] = {
      SESSION_ID: crypto.randomUUID(),
      round_number: 0
    };
  }

  const state = sessionState[tabId];
  state.round_number += 1;
  const roundNum = state.round_number;
  const seqNum = String(roundNum).padStart(8, '0'); // %8.8d equivalent

  // Get Hostname from storage
  const { hostname } = await chrome.storage.local.get(['hostname']);
  const HOSTNAME = hostname || 'unknown-host';

  // Format Date and Time
  const now = new Date();
  const YYYY = now.getFullYear();
  const MM = String(now.getMonth() + 1).padStart(2, '0');
  const DD = String(now.getDate()).padStart(2, '0');
  const dateStr = `${YYYY}-${MM}-${DD}`;
  
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const timeStr = `${hh}-${mm}-${ss}`;

  // Base filename
  const baseFilename = `flush.${state.SESSION_ID}.${dateStr}.${timeStr}.${HOSTNAME}.${seqNum}`;
  const folderPath = `${dateStr}/`; // Saves in Downloads/YYYY-MM-DD/

  // 1. Create Markdown content
  const mdContent = createMarkdown(payload, state.SESSION_ID, roundNum);
  const mdBlob = new Blob([mdContent], { type: 'text/markdown' });
  const mdUrl = URL.createObjectURL(mdBlob);

  // 2. Create JSON Metadata content
  const jsonContent = createJsonMetadata(payload, state.SESSION_ID, roundNum, dateStr, timeStr, HOSTNAME);
  const jsonBlob = new Blob([JSON.stringify(jsonContent, null, 2)], { type: 'application/json' });
  const jsonUrl = URL.createObjectURL(jsonBlob);

  // Trigger Downloads
  chrome.downloads.download({
    url: mdUrl,
    filename: `${folderPath}${baseFilename}.md`,
    saveAs: false
  });

  chrome.downloads.download({
    url: jsonUrl,
    filename: `${folderPath}${baseFilename}.json`,
    saveAs: false
  });
}

function createMarkdown(payload, sessionId, roundNum) {
  let md = `# LLM Forensic Log\n\n`;
  md += `**Session ID:** ${sessionId}\n`;
  md += `**Round:** ${roundNum}\n\n`;
  md += `## User Prompt\n\n${payload.prompt}\n\n`;
  
  if (payload.thinking && payload.thinking.trim().length > 0) {
    md += `## LLM Thinking\n\n\`\`\`\n${payload.thinking}\n\`\`\`\n\n`;
  }
  
  md += `## LLM Response\n\n${payload.response}\n`;
  return md;
}

function createJsonMetadata(payload, sessionId, roundNum, dateStr, timeStr, hostname) {
  // Forensic metrics
  const responseWords = payload.response.split(/\s+/).length;
  const promptWords = payload.prompt.split(/\s+/).length;
  
  // Heuristic drift/hallucination indicators (basic)
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
        dom_node_count_at_log: payload.domNodeCount
      },
      drift_and_hallucination_indicators: {
        hedging_language_count: hedgingWords,
        self_correction_count: selfCorrections,
        lexical_diversity: calculateLexicalDiversity(payload.response)
      }
    },
    system_info: {
      url_origin: payload.origin
    }
  };
}

function calculateLexicalDiversity(text) {
  const words = text.toLowerCase().match(/\b(\w+)\b/g) || [];
  if (words.length === 0) return 0;
  const uniqueWords = new Set(words);
  return uniqueWords.size / words.length; // Type-Token Ratio
}
