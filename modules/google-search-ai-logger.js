// @match *://www.google.com/search*
// @match *://*.google.com/search*
// @host_permissions *://www.google.com/*
// @host_permissions *://*.google.com/*
// @run_at document_idle

/**
 * google-search-ai-logger.js
 * 
 * Module for the LLM-Forensic-Logger extension.
 * Specifically targets Google Search "AI Mode History" sessions.
 * 
 * Structural Anchors discovered:
 *   Container: id="aim-chrome-initial-inline-async-container"
 *   Turn:      data-scope-id="turn"
 */

const MODULE_NAME = 'google-search-ai';

// ─── Structural Anchors ───
const CHAT_CONTAINER_ID = 'aim-chrome-initial-inline-async-container';
const TURN_SELECTOR = '[data-scope-id="turn"]';

// ─── 1. Container & Turn Detection ───

function getAiChatContainer() {
  return document.querySelector(`#${CHAT_CONTAINER_ID}`);
}

function extractAiTurns(container) {
  if (!container) return [];
  
  const turns = Array.from(container.querySelectorAll(TURN_SELECTOR));
  console.log(`[${MODULE_NAME}] Found ${turns.length} AI Turns in history container.`);
  
  return turns;
}

// ─── 2. Smart DOM Cleaning & Text Extraction ───
// This replaces the brute-force innerText grab that resulted in 58K+ char bloat.
// It walks the tree, ignores UI chrome (buttons, svgs, hidden elements), 
// and captures only visible prose and citation links.

function cleanTurnElement(turnEl) {
  const proseParts = [];
  const citations = [];

  // Recursive function to walk the DOM node by node
  function walkNode(node) {
    // Skip entire subtrees if they are UI noise
    if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = node.tagName.toLowerCase();
      
      // Ignore buttons, SVGs, scripts, styles, and hidden accessibility spans
      if (tag === 'button' || tag === 'svg' || tag === 'script' || tag === 'style') return;
      if (node.getAttribute('aria-hidden') === 'true') return;
      
      // If it's a citation link, grab the URL and text, then stop descending
      if (tag === 'a' && node.href) {
        const linkText = (node.textContent || '').trim();
        if (linkText.length > 0 && linkText.length < 100) { // Filter out weird long text links
          proseParts.push(linkText);
          citations.push({
            text: linkText,
            url: node.href
          });
        }
        return; // Don't descend into links further to avoid duplicate text
      }
    }

    // If it's a text node, grab the visible text
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent.trim();
      if (text.length > 0) {
        // Filter out known Google UI noise strings
        if (text !== 'CopiedCopyEdit' && text !== 'Copy' && text !== 'Edit') {
          proseParts.push(text);
        }
      }
      return;
    }

    // Recurse into children
    for (const child of node.childNodes) {
      walkNode(child);
    }
  }

  walkNode(turnEl);

  // Join the prose parts with spaces, cleaning up weird spacing
  const cleanedText = proseParts.join(' ')
    .replace(/\s+/g, ' ') // Collapse multiple spaces
    .trim();

  return {
    rawLength: (turnEl.textContent || '').trim().length,
    cleanedLength: cleanedText.length,
    text: cleanedText,
    citations: citations
  };
}

// ─── 3. Processing & Formatting the Conversation ───

function processConversation(turns) {
  const conversationLog = [];

  turns.forEach((turnEl, index) => {
    const cleanedData = cleanTurnElement(turnEl);
    
    console.log(`[${MODULE_NAME}]   Turn [${index}]: rawLen=${cleanedData.rawLength} -> cleanedLen=${cleanedData.cleanedLength} citations=${cleanedData.citations.length}`);
    console.log(`[${MODULE_NAME}]   Turn [${index}] Preview: "${cleanedData.text.substring(0, 120)}..."`);

    conversationLog.push({
      turnIndex: index,
      text: cleanedData.text,
      citations: cleanedData.citations
      // Note: In a real forensic logger, you might want to detect if this turn 
      // is a "User Prompt" or an "AI Response" based on sub-elements inside the turn.
      // For now, we are just extracting the clean text linearly.
    });
  });

  return conversationLog;
}

  // ─── 4. MutationObserver (SPA-Proof) ───
  // Instead of observing the fragile container, we observe the whole body
  // and specifically listen for the injection of 'turn' elements.

  function observeForAiTurns() {
    console.log(`[${MODULE_NAME}] Attaching global SPA Observer to document.body...`);

    const observer = new MutationObserver((mutationsList) => {
      for (const mutation of mutationsList) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              
              // Check if the added node IS a turn, or CONTAINS a turn
              const isTurn = node.matches(TURN_SELECTOR);
              const containsTurns = node.querySelector(TURN_SELECTOR);

              if (isTurn || containsTurns) {
                console.log(`[${MODULE_NAME}] SPA Observer detected AI Turns injected!`);
                
                // Disconnect observer temporarily to avoid infinite loops during extraction
                observer.disconnect();

                // Wait a brief moment for Google's slow UI to finish rendering text
                setTimeout(() => {
                  processCurrentHistoryView();
                  // Re-observe after processing so we catch the NEXT history click
                  observeForAiTurns();
                }, 500); 

                return; // Exit the loop, we found our target
              }
            }
          }
        }
      }
    });

    // Observe the whole body, subtree true, so we catch injections anywhere on the page
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ─── 5. Processing & Formatting the Conversation ───

  function processCurrentHistoryView() {
    // Re-query the container and turns fresh (they might be new DOM nodes now)
    const container = getAiChatContainer();
    if (!container) {
      console.log(`[${MODULE_NAME}] Container vanished before processing could begin.`);
      return;
    }

    const turns = extractAiTurns(container);
    if (turns.length === 0) {
      console.log(`[${MODULE_NAME}] Turns detected, but extraction found 0 elements. DOM might still be loading.`);
      return;
    }

    const conversationLog = [];

    turns.forEach((turnEl, index) => {
      const cleanedData = cleanTurnElement(turnEl);
      
      console.log(`[${MODULE_NAME}]   Turn [${index}]: rawLen=${cleanedData.rawLength} -> cleanedLen=${cleanedData.cleanedLength} citations=${cleanedData.citations.length}`);
      console.log(`[${MODULE_NAME}]   Turn [${index}] Preview: "${cleanedData.text.substring(0, 120)}..."`);

      conversationLog.push({
        turnIndex: index,
        text: cleanedData.text,
        citations: cleanedData.citations
      });
    });

    console.log(`[${MODULE_NAME}] Forensic Log Complete. Turns processed: ${conversationLog.length}`);
    console.log(`[${MODULE_NAME}] Final Log Object:`, conversationLog);
    
    // ────── LOG TO EXTENSION STORAGE HERE ──────
    // chrome.storage.local.set({ googleAiHistory: conversationLog });
  }

  // ─── 6. Initialization ───

  function init() {
    console.log(`[${MODULE_NAME}] Initializing Forensic Logger...`);
    
    // 1. Check if a history conversation is already fully rendered on the page 
    // (e.g., if the user refreshed the page while looking at one)
    const existingTurns = document.querySelectorAll(TURN_SELECTOR);
    if (existingTurns.length > 0) {
      console.log(`[${MODULE_NAME}] Found ${existingTurns.length} existing Turns on page load. Processing immediately.`);
      processCurrentHistoryView();
      // We still start the observer so we catch it if they click a different history item
      observeForAiTurns();
    } else {
      // 2. If no turns exist yet, start the observer to wait for the user to click one
      observeForAiTurns();
    }
  }

  // Run initialization
  init();
