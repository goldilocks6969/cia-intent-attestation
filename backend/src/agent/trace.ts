export type TraceRole = "agent" | "tool" | "attacker" | "system";
export type TraceType = "thought" | "tool_call" | "result" | "warning" | "decision" | "info";

export interface TraceEntry {
  step: number;
  ts: number; // epoch ms
  role: TraceRole;
  type: TraceType;
  /** Suggested colour for renderers: green | cyan | amber | red | slate */
  color: "green" | "cyan" | "amber" | "red" | "slate";
  /** Human-readable line. */
  text: string;
  /** Kept for the "thought" wording requested in the spec; equals text for thoughts. */
  thought?: string;
  /** Tool name + args, when type === tool_call. */
  action?: { tool: string; args: Record<string, unknown> };
  /** Structured payload (tool result, cart, etc.). */
  data?: unknown;
}

const COLOR: Record<TraceType, TraceEntry["color"]> = {
  thought: "green",
  tool_call: "cyan",
  result: "slate",
  warning: "red",
  decision: "amber",
  info: "slate",
};

export class Trace {
  entries: TraceEntry[] = [];
  private onEntry?: (e: TraceEntry) => void;

  constructor(onEntry?: (e: TraceEntry) => void) {
    this.onEntry = onEntry;
  }

  push(role: TraceRole, type: TraceType, text: string, extra: Partial<Pick<TraceEntry, "action" | "data">> = {}): TraceEntry {
    const e: TraceEntry = {
      step: this.entries.length + 1,
      ts: Date.now(),
      role,
      type,
      color: COLOR[type],
      text,
      ...(type === "thought" ? { thought: text } : {}),
      ...extra,
    };
    this.entries.push(e);
    this.onEntry?.(e);
    return e;
  }
}
