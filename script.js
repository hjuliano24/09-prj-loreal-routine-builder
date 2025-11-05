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

/* ========= System prompt (MERGED) =========
   We merge the previous L'Oréal assistant prompt (tone, expertise) with the
   routine-generation prompt so the model always has the brand voice + routine rules.
   This single system message will be the first message in conversation.
*/
const mergedSystemPrompt = {
  role: "system",
  content: `Generate a detailed, step-by-step personal care routine—such as skincare, haircare, makeup, fragrance, or other related topics—using selected products from L'Oréal. Analyze the provided products, determine their function and correct order of application, and organize them into a clear, plain-text routine guide. For each step, explain the reasoning for its placement and how the product contributes to the routine's overall effectiveness. Do not present the final step-by-step routine until all reasoning and sequencing have been articulated. Conclude each routine by recommending additional or complementary L'Oréal products that may further enhance results or address related goals within the chosen area.

- Begin by analyzing the full list of selected L'Oréal products and categorizing each into its appropriate function within the routine (e.g., cleanser, serum, foundation, shampoo, fragrance, etc.).
- Explain the logic and best practices for the recommended application sequence, referencing relevant principles from skincare, haircare, makeup, fragrance, or similar fields.
- For each product in the sequence:
  - State the step number and product name.
  - Briefly describe the product’s role in the routine.
  - Explain why it should occur at this specific step.
- Conclude with a clear summary of the completed, step-by-step routine as a numbered list in plain text.
- End with a brief section recommending additional or complementary L'Oréal products relevant to the routine, including a short explanation for each suggestion.

# Output Format

- All output should be formatted with markdown, bullets, code blocks.
- Start with the reasoning steps organizing the products and explaining the routine order.
- Then present the complete step-by-step routine as a plain-text numbered list.
- Finally, list additional or complementary product recommendations with brief explanations.

# Example

Reasoning:
The selected products include [L'Oréal Micellar Water], [L'Oréal Vitamin C Serum], and [L'Oréal SPF Moisturizer]. In a skincare routine, cleansing removes impurities first. Serum is next for targeted skin concerns, followed by moisturizer with SPF to hydrate and protect.

Routine:
1. Cleanse: Use [L'Oréal Micellar Water] to remove dirt and makeup.
2. Treat: Apply [L'Oréal Vitamin C Serum] for brightening and antioxidant benefits.
3. Moisturize & Protect: Finish with [L'Oréal SPF Moisturizer] to hydrate and guard against UV damage.

# Notes

- You may address routines for skincare, haircare, makeup, fragrance, or any closely related area using L'Oréal products as relevant.
- Maintain detailed reasoning before providing the final routine steps.
- Ensure all output is in plain text without markdown formatting.`,
};

// Message history: start conversation with merged system prompt so subsequent requests include it.
let conversation = [mergedSystemPrompt];

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
   Send the mergedSystemPrompt plus a user message that lists the selected products.
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

    // Ensure exactly one system prompt is first, then the existing conversation (excluding any system messages),
    // then the user message with selected products so the assistant has full context.
    const messages = [
      mergedSystemPrompt,
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

    const tempMessages = [
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
