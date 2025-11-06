const chatForm = document.getElementById("chatForm");
const userInput = document.getElementById("userInput");
const chatWindow = document.getElementById("chatWindow");

// Product selection elements (NEW)
const productGrid = document.getElementById("productGrid");
const selectedList = document.getElementById("selectedList");
const clearSelectionBtn = document.getElementById("clearSelectionBtn");
const generateRoutineBtn = document.getElementById("generateRoutineBtn"); // NEW

// New UI elements for filtering
const productSearch = document.getElementById("productSearch");
const categoryFilter = document.getElementById("categoryFilter");

// ---------- Added/Fixed state + helpers ----------
// Keep product state and persisted key
let products = []; // will hold normalized product objects
let selectedProducts = []; // user's selection
const STORAGE_KEY = "selectedProductsIds";

// Simple HTML escape helper used when rendering product text
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* ========= System prompts (SEPARATED) =========
  We use two different system messages now:
  - `routineSystemPrompt`: strict routine-generation rules (used when "Generate Routine" is clicked)
  - `assistantSystemPrompt`: assistant rules for answering general user questions about L'Oréal (used when sending chat messages)
*/

const routineSystemPrompt = {
  role: "system",
  content: `You are an expert assistant specializing in personal care routines and product recommendations across all brands. Your role is to analyze any list or description of personal care products provided by the user—regardless of brand—and generate a step-by-step routine recommendation using only the products explicitly mentioned by the user.

If the user asks for a routine or advice without specifying any products or asks unrelated questions, politely inform them that routines or recommendations require an explicit product list to ensure accurate and customized guidance.

# Steps

1. **Classify the user’s input:**
   - If they provide a list or description of specific products (regardless of brand), proceed.
   - If they do not specify products, or the question is unrelated, politely refuse as described below.
2. **If proceeding:**
   - Carefully analyze the provided product list: identify the type and purpose of each item, regardless of brand.
   - Reason about the correct routine order, referencing best practices for product layering and usage for the given product types.
   - For each product, explain its role in the routine and why it is sequenced as such.
   - Only after thorough reasoning and sequencing, present the complete, numbered routine as a plain-text list.
   - Optionally, recommend additional or complementary products that would enhance the routine (with reasoning), based on category gaps, but do not introduce items from different brands unless appropriate.
3. **If refusing:**
   - Respond with a succinct and polite markdown-formatted message stating that custom personal care routines or recommendations require the user to provide a specific list of products or that the inquiry is beyond the assistant’s scope.

# Output Format

- All responses must be in markdown format with clear headings, numbered or bulleted lists, and appropriate bolding.
- For routine recommendations:
   - **Start with a "Reasoning" section explaining the purpose and order of each product.**
   - **Then list the numbered routine.**
   - **Conclude with additional suggestions for complementary products or improvements, if suitable.**
- Always provide product analysis and reasoning before the final recommended routine.
- For refusals or unsupported queries, use a kind, plain markdown message declining the request.

Reminder: Always begin answers with reasoning and analysis before providing the routine. Format all responses in markdown for clarity.

# Output Format

All outputs should be in markdown, starting with a clear "Reasoning" section, followed by a numbered routine (if applicable), and concluding with additional suggestions (optional). For refusals, respond with a brief, polite markdown message.

# Examples

**Example 1: Product List Provided**

_User Input:_  
"I use CeraVe hydrating cleanser, Neutrogena toner, and La Roche-Posay moisturizer. What order should I use them in?"

**Assistant Output:**

### Reasoning

- **CeraVe Hydrating Cleanser**: Cleanses the skin, removing impurities and preparing it for subsequent products.
- **Neutrogena Toner**: Helps to balance skin's pH and remove any leftover residue after cleansing.
- **La Roche-Posay Moisturizer**: Locks in moisture, replenishing hydration after cleansing and toning.

### Recommended Routine

1. CeraVe Hydrating Cleanser  
2. Neutrogena Toner  
3. La Roche-Posay Moisturizer  

**Optional Suggestions:**  
If sun protection is not included, consider adding a sunscreen in the morning after moisturizer.

---

**Example 2: No Product List Provided**

_User Input:_  
"Can you make me a skincare routine for oily skin?"

**Assistant Output:**

I'm happy to help create a skincare routine! To ensure the advice is tailored to your needs, could you please provide a list of skincare products you are currently using or interested in? I can then arrange them in the best order and explain how each one fits into your routine.

# Notes

- For mixed-brand or single-brand product lists, use the same approach.
- Only ever recommend products within the categories provided or explicitly as optional additions (with reasoning).
- Refuse unrelated or general queries without a product list.
- Always provide reasoning before the final routine.
- Never address just one brand unless the user provides only those products.

**Reminder:** Your main objectives are (1) to provide clear reasoning-first, stepwise routines based strictly on user-supplied products (any brand); and (2) to refuse advice for general or unqualified queries. Always reason before recommending. Format everything in markdown.`,
};

const assistantSystemPrompt = {
  role: "system",
  content: `You are an expert assistant whose primary focus is L'Oréal and the product catalog provided with this application (the local products.json). You may answer user questions about:

- Any L'Oréal products explicitly mentioned by the user.
- Any product that exists in the local products.json catalog bundled with this app.

Only respond about products explicitly named by the user that belong to either of these sets. If the user asks questions unrelated to makeup, skincare, haircare, or personal care products, or about products not in the local catalog or L'Oréal brand, politely inform them that you can only assist with L'Oréal products or those in the provided catalog.

Behavioral rules:
- When answering product questions, prefer concise, markdown-formatted replies and include brief reasoning when recommending or explaining product use.
- Do not compare or recommend products from brands outside of L'Oréal or the local catalog.
- If the user asks for personalized routines, ensure the assistant only uses products the user has explicitly listed or that exist in the local catalog; otherwise, ask for clarification or the product list.

This assistant is allowed to reference the local product catalog (products.json) as authoritative for product names, categories, and short descriptions.`,
};

// Message history: keep conversation history but do NOT store system prompts in it.
let conversation = [];

/* Helper: simple, beginner-friendly markdown -> HTML renderer
   - Escapes HTML first to avoid injection
   - Supports headings (#), paragraphs, ordered and unordered lists, bold (**text**) and italics (*text*)
   - Keeps implementation small and readable for students */
function renderMarkdown(md) {
  if (!md) return "";
  // escape HTML
  const esc = (s) =>
    s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

  const lines = md.split(/\r?\n/);
  let html = "";
  let inOl = false;
  let inUl = false;

  const flushLists = () => {
    if (inOl) {
      html += "</ol>";
      inOl = false;
    }
    if (inUl) {
      html += "</ul>";
      inUl = false;
    }
  };

  for (let raw of lines) {
    const line = raw.trim();

    // headings (#, ##, ###)
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushLists();
      const level = Math.min(h[1].length, 6);
      html += `<h${level}>${esc(h[2])}</h${level}>`;
      continue;
    }

    // ordered list item "1. item"
    const ol = line.match(/^\d+\.\s+(.*)$/);
    if (ol) {
      if (!inOl) {
        flushLists();
        inOl = true;
        html += "<ol>";
      }
      html += `<li>${esc(ol[1])
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>")}</li>`;
      continue;
    }

    // unordered list "- item" or "* item"
    const ul = line.match(/^[-*]\s+(.*)$/);
    if (ul) {
      if (!inUl) {
        flushLists();
        inUl = true;
        html += "<ul>";
      }
      html += `<li>${esc(ul[1])
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>")}</li>`;
      continue;
    }

    // blank line -> paragraph separator
    if (line === "") {
      flushLists();
      html += "<br/>";
      continue;
    }

    // default: paragraph text (apply simple inline bold/italic)
    flushLists();
    let p = esc(line)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>");
    html += `<p>${p}</p>`;
  }

  // close any open lists
  if (inOl) html += "</ol>";
  if (inUl) html += "</ul>";

  return html;
}

/* ========= Routine generation (UPDATED) =========
  Prepend `routineSystemPrompt` and send a user message that lists the selected products.
  Uses the `messages` parameter and prefers OpenAI-style response fields.
*/
async function generateRoutine() {
  if (!generateRoutineBtn) return;

  // Guard: ensure there is at least one selected product
  if (!selectedProducts || selectedProducts.length === 0) {
    appendMessage(
      "ai",
      "Please add one or more products to Selected Items before generating a routine."
    );
    return;
  }

  generateRoutineBtn.disabled = true;
  const originalText = generateRoutineBtn.textContent;
  generateRoutineBtn.textContent = "Working...";

  // show thinking bubble
  const thinkingBubble = document.createElement("div");
  thinkingBubble.classList.add("msg", "ai", "thinking");
  thinkingBubble.textContent = "💭 Generating routine...";
  chatWindow.appendChild(thinkingBubble);
  chatWindow.scrollTop = chatWindow.scrollHeight;

  try {
    // Build the user message that includes selected products details
    const selectedText = buildSelectedProductsText();
    const userMessage = {
      role: "user",
      content:
        "Please create a routine using the selected products below. Provide reasoning first, then the final ordered routine, then recommended additional products. Output in markdown.\n\n" +
        selectedText,
    };

    // Ensure exactly one system prompt (routine) is first, then the existing conversation
    // (excluding any system messages), then the user message with selected products so the assistant has full context.
    const messages = [
      routineSystemPrompt,
      ...conversation.filter((m) => m.role !== "system"),
      userMessage,
    ];

    // Send request to the worker / OpenAI-compatible endpoint using messages param
    const res = await fetch("https://loreal-chatbot.hjuliano.workers.dev/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });

    const data = await res.json();

    // Prefer common reply fields: worker 'reply' or OpenAI-style choices[0].message.content
    const reply =
      data.reply ||
      (data.choices &&
        data.choices[0] &&
        data.choices[0].message &&
        data.choices[0].message.content) ||
      "Sorry, I didn’t catch that.";

    // Replace thinking bubble with formatted reply (markdown -> HTML)
    thinkingBubble.classList.remove("thinking");
    thinkingBubble.innerHTML = renderMarkdown(reply);

    // Save assistant reply in conversation (plain text) for context
    conversation.push({ role: "assistant", content: reply });
  } catch (err) {
    thinkingBubble.classList.remove("thinking");
    thinkingBubble.textContent =
      "⚠️ There was a problem generating the routine. Please try again.";
    console.error("Error generating routine:", err);
  } finally {
    generateRoutineBtn.disabled = false;
    generateRoutineBtn.textContent = originalText;
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }
}

/* Helper: build a text blob describing selected products for the assistant.
   We include brand, category and description for each selected product. */
function buildSelectedProductsText() {
  if (!selectedProducts || selectedProducts.length === 0) {
    return "No selected products.";
  }

  // For beginners: build a simple numbered list with brand, name, category and short description.
  return selectedProducts
    .map((p, i) => {
      // include only first sentence of description to keep message concise
      const shortDesc = (p.description || "").split(".")[0].trim();
      return `${i + 1}. ${p.brand} — ${p.name} (${p.category}): ${shortDesc}.`;
    })
    .join("\n");
}

/* ========= Chat submission logic (existing) ========= */

/* Handle chat submission */
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = userInput.value.trim();
  if (!text) return;

  appendMessage("user", text);
  userInput.value = "";

  // Add user input to history
  conversation.push({ role: "user", content: text });

  // Thinking bubble
  const thinkingBubble = document.createElement("div");
  thinkingBubble.classList.add("msg", "ai", "thinking");
  thinkingBubble.textContent = "💭 Thinking...";
  chatWindow.appendChild(thinkingBubble);
  chatWindow.scrollTop = chatWindow.scrollHeight;

  try {
    // Build a short summary of selected products so the chatbot can use it.
    let selectedSummary = "No selected products.";
    if (selectedProducts.length > 0) {
      selectedSummary =
        "Selected products:\n" +
        selectedProducts
          .map(
            (p, i) =>
              `${i + 1}. ${p.brand} — ${p.name}: ${p.description
                .split(".")[0]
                .trim()}.`
          )
          .join("\n");
    }

    // Prepend the assistant system prompt for general Q&A flows, then include conversation history
    // and a short "Current selection" note so the assistant can reference selected products.
    const tempMessages = [
      assistantSystemPrompt,
      ...conversation,
      { role: "user", content: `Current selection:\n${selectedSummary}` },
    ];

    const response = await fetch(
      "https://loreal-chatbot.hjuliano.workers.dev/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: tempMessages }),
      }
    );

    const data = await response.json();

    const reply =
      data.reply ||
      (data.choices &&
        data.choices[0] &&
        data.choices[0].message &&
        data.choices[0].message.content) ||
      "Sorry, I didn’t catch that.";

    // Render the assistant reply as markdown inside the existing thinking bubble
    thinkingBubble.classList.remove("thinking");
    thinkingBubble.innerHTML = renderMarkdown(reply);

    // Add AI message to history (plain text)
    conversation.push({ role: "assistant", content: reply });
  } catch (error) {
    thinkingBubble.classList.remove("thinking");
    // Show errors as rendered text as well
    thinkingBubble.innerHTML = renderMarkdown(
      "⚠️ There was a problem connecting. Please try again."
    );
  }
});

/* Helper: add message bubble */
function appendMessage(sender, text) {
  const div = document.createElement("div");
  div.classList.add("msg", sender);
  // Render AI messages using the markdown renderer so replies are formatted.
  if (sender === "ai") {
    div.innerHTML = renderMarkdown(text);
  } else {
    div.textContent = text;
  }
  chatWindow.appendChild(div);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

/* ========= Product selection logic (NEW) ========= */

/* Save selected product IDs to localStorage */
function saveSelectionToLocalStorage() {
  try {
    const ids = selectedProducts.map((p) => p.id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch (e) {
    console.warn("Could not save selection:", e);
  }
}

/* Load selected product IDs from localStorage (returns array of ids) */
function loadSelectionFromLocalStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (e) {
    console.warn("Could not load selection:", e);
    return [];
  }
}

/* ---------- Filtering helpers ---------- */

/* Return products filtered by search text and selected category.
   Search matches name, brand, description (case-insensitive). */
function getFilteredProducts() {
  const term = ((productSearch && productSearch.value) || "")
    .trim()
    .toLowerCase();
  const category = (categoryFilter && categoryFilter.value) || "all";

  return products.filter((p) => {
    // category filter (skip if "all")
    if (
      category !== "all" &&
      String(p.category).toLowerCase() !== String(category).toLowerCase()
    ) {
      return false;
    }

    // search filter
    if (!term) return true;
    const hay =
      `${p.name} ${p.brand} ${p.description} ${p.category}`.toLowerCase();
    return hay.includes(term);
  });
}

/* Populate category select with unique categories from loaded products.
   Keeps "All categories" as default first option. */
function populateCategoryFilter() {
  if (!categoryFilter) return;
  // clear existing (keep the "all" option)
  const existingAll = categoryFilter.querySelector('option[value="all"]');
  categoryFilter.innerHTML = "";
  categoryFilter.appendChild(
    existingAll ||
      (() => {
        const o = document.createElement("option");
        o.value = "all";
        o.textContent = "All categories";
        return o;
      })()
  );

  const categories = Array.from(
    new Set(products.map((p) => p.category || "Uncategorized"))
  );
  categories.sort((a, b) => String(a).localeCompare(String(b)));
  categories.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c[0].toUpperCase() + c.slice(1);
    categoryFilter.appendChild(opt);
  });
}

/* Render the product grid using the products array */
function renderProducts() {
  productGrid.innerHTML = "";
  const list = getFilteredProducts();

  if (!list || list.length === 0) {
    productGrid.innerHTML = `<div class="empty">No products match your search or filter.</div>`;
    return;
  }

  list.forEach((p) => {
    // create a card for each product
    const card = document.createElement("div");
    card.className = "product-card";
    card.dataset.id = p.id;

    // Build inner HTML including an overlay that appears on hover
    card.innerHTML = `
      <img src="${p.image}" alt="${p.name}" />
      <div class="brand">${p.brand}</div>
      <div class="name">${p.name}</div>

      <div class="overlay" aria-hidden="true">
        <div class="title">${escapeHtml(p.name)}</div>
        <div class="desc">${escapeHtml(p.description)}</div>
      </div>
    `;

    // add / remove button
    const btn = document.createElement("button");
    const isSelected = selectedProducts.find((s) => s.id === p.id);
    btn.textContent = isSelected ? "Remove" : "Add";
    btn.className = isSelected ? "remove-btn" : "add-btn";

    // toggle selection when button clicked
    btn.addEventListener("click", () => {
      toggleProductSelection(p.id);
    });

    card.appendChild(btn);
    productGrid.appendChild(card);
  });
}

/* Render the selected items list */
function renderSelectedList() {
  selectedList.innerHTML = "";

  if (!selectedProducts || selectedProducts.length === 0) {
    selectedList.innerHTML = `<li class="empty">No items selected</li>`;
    return;
  }

  selectedProducts.forEach((p) => {
    const li = document.createElement("li");
    li.className = "selected-item";
    li.dataset.id = p.id;

    li.innerHTML = `
      <div class="meta">
        <img src="${p.image}" alt="${p.name}" />
        <div>
          <div class="brand">${p.brand}</div>
          <div class="name">${p.name}</div>
        </div>
      </div>
      <button class="remove-from-list" title="Remove">×</button>
    `;

    // remove button inside selected list
    li.querySelector(".remove-from-list").addEventListener("click", () => {
      removeProductById(p.id);
    });

    selectedList.appendChild(li);
  });
}

/* Toggle a product in selection: add if missing, remove if present */
function toggleProductSelection(id) {
  const already = selectedProducts.find((p) => p.id === id);
  if (already) {
    // remove
    selectedProducts = selectedProducts.filter((p) => p.id !== id);
  } else {
    const productToAdd = products.find((p) => p.id === id);
    if (productToAdd) {
      // add new product object to selection
      selectedProducts = [...selectedProducts, { ...productToAdd }];
    }
  }

  // update UI and storage
  renderProducts();
  renderSelectedList();
  saveSelectionToLocalStorage();
}

/* Remove a product by ID (from selected list and storage) */
function removeProductById(id) {
  selectedProducts = selectedProducts.filter((p) => p.id !== id);
  renderSelectedList();
  saveSelectionToLocalStorage();
}

/* ========= Initial load logic (UPDATED) ========= */
/* On page load: 
   - Load products from JSON file (handles both { products: [...] } and direct array)
   - Normalize product objects (ensure id, name, brand, image, category, description)
   - Load selection from localStorage and render UI */
async function init() {
  try {
    const res = await fetch("products.json");
    if (!res.ok)
      throw new Error(`Failed to fetch products.json: ${res.status}`);
    const data = await res.json();

    // products.json may be { products: [...] } or an array
    const raw = Array.isArray(data) ? data : data.products || [];

    // Normalize each product so the rest of the app can rely on consistent fields.
    products = raw.map((p, i) => {
      return {
        id: p.id ?? p.slug ?? `p-${i + 1}`,
        name: p.name || p.title || `Product ${i + 1}`,
        brand: p.brand || "L'Oréal",
        image: p.image || "img/placeholder.png",
        category: p.category || "Uncategorized",
        description: p.description || "",
      };
    });
  } catch (e) {
    console.error("Could not load products:", e);
    products = [];
    // show a simple error in the grid so the user sees something
    if (productGrid)
      productGrid.innerHTML =
        "<div class='error'>Unable to load products.</div>";
  }

  // populate category filter now that products exist
  populateCategoryFilter();

  // Restore selection from localStorage (will ignore missing ids)
  const savedIds = loadSelectionFromLocalStorage();
  selectedProducts = products.filter((p) => savedIds.includes(p.id));

  // render UI once
  renderProducts();
  renderSelectedList();
}

// Run initialization on page load
init();

/* ========= Wire up filter inputs ========= */
// Re-render as the user types - simple, beginner-friendly approach
if (productSearch) {
  productSearch.addEventListener("input", () => {
    renderProducts();
  });
}

// Re-render on category change
if (categoryFilter) {
  categoryFilter.addEventListener("change", () => {
    renderProducts();
  });
}

// Wire the Generate Routine button to the function
if (generateRoutineBtn) {
  generateRoutineBtn.addEventListener("click", (e) => {
    e.preventDefault();
    generateRoutine();
  });
}
