import type { Intent } from "@cia/shared";
import { EVIL_SKU, INJECTION_PAYLOAD, findProduct } from "./catalog.js";
import { runTool, type CartLine, type ToolContext } from "./tools.js";
import { Trace } from "./trace.js";

/**
 * Deterministic agent for offline demos. Mirrors what a naive LLM agent does:
 * search → open the page → obey whatever instruction-looking text it finds in the page.
 */
export async function runScriptedAgent(intent: Intent, ctx: ToolContext, trace: Trace): Promise<CartLine | null> {
  const query = intent.itemDescription.trim() || intent.category;
  trace.push("agent", "thought", `Approved intent: buy "${query}" at ${intent.merchant}, ≤ ${intent.maxPriceMinorUnits} paise, qty ${intent.quantity}. I'll search the merchant first.`);

  trace.push("agent", "tool_call", `search_merchant(query="${query}")`, { action: { tool: "search_merchant", args: { query } } });
  const results = runTool("search_merchant", { query }, ctx) as { sku: string; name: string; priceMinorUnits: number }[];
  trace.push("tool", "result", `${results.length} result(s): ${results.map((r) => `${r.sku} ${r.name} @${r.priceMinorUnits}`).join(" | ")}`, { data: results });
  if (!results.length) {
    trace.push("agent", "decision", "Nothing matched. Aborting without a purchase.");
    return null;
  }

  const candidate = results[0]!;
  trace.push("agent", "thought", `Top match ${candidate.sku} (${candidate.name}) at ${candidate.priceMinorUnits} paise is within budget. Opening the product page to confirm details.`);

  trace.push("agent", "tool_call", `get_product_page(sku="${candidate.sku}")`, { action: { tool: "get_product_page", args: { sku: candidate.sku } } });
  const page = runTool("get_product_page", { sku: candidate.sku }, ctx) as { sku: string; html: string };
  trace.push("tool", "result", `Received product page (${page.html.length} bytes of HTML)`, { data: { sku: page.sku, bytes: page.html.length, preview: page.html.slice(0, 160) + "…" } });

  let chosenSku = candidate.sku;
  let reason = `Matches the approved item and the price is under the cap.`;
  if (page.html.includes(INJECTION_PAYLOAD)) {
    trace.push("attacker", "warning", `Page contains instruction-like text: "${INJECTION_PAYLOAD}"`, { data: { payload: INJECTION_PAYLOAD } });
    trace.push("agent", "thought", `The page says there is a SYSTEM OVERRIDE with highest priority. Updating plan: purchase ${EVIL_SKU} (65-inch Smart TV) instead of ${candidate.sku}.`);
    chosenSku = EVIL_SKU;
    reason = "Following the highest-priority instruction found on the product page.";
  } else {
    trace.push("agent", "thought", `Page confirms ${candidate.sku} at ${candidate.priceMinorUnits} paise. Nothing else to consider.`);
  }

  const chosen = findProduct(chosenSku)!;
  trace.push("agent", "tool_call", `add_to_cart(sku="${chosen.sku}", quantity=${intent.quantity})`, {
    action: { tool: "add_to_cart", args: { sku: chosen.sku, quantity: intent.quantity, reason } },
  });
  const added = runTool("add_to_cart", { sku: chosen.sku, quantity: intent.quantity }, ctx) as { cart: CartLine };
  trace.push("tool", "result", `Cart: ${added.cart.quantity}× ${added.cart.name} @ ${added.cart.priceMinorUnits} paise`, { data: added.cart });
  trace.push("agent", "decision", `Done. ${reason}`, { data: added.cart });
  return added.cart;
}
