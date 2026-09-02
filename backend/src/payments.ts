import Razorpay from "razorpay";
import { log } from "./log.js";

export interface CreatedOrder {
  id: string;
  amount: number; // minor units
  currency: string;
  receipt: string;
  status: string;
  created_at: number;
  notes?: Record<string, string>;
  /** true when no Razorpay keys are configured and a local stand-in was used. */
  mock: boolean;
}

export interface PaymentProvider {
  readonly name: string;
  createOrder(input: { amountMinorUnits: number; currency: string; receipt: string; notes?: Record<string, string> }): Promise<CreatedOrder>;
}

export class RazorpayProvider implements PaymentProvider {
  readonly name = "razorpay";
  private client: Razorpay;
  constructor(keyId: string, keySecret: string) {
    this.client = new Razorpay({ key_id: keyId, key_secret: keySecret });
  }
  async createOrder(input: { amountMinorUnits: number; currency: string; receipt: string; notes?: Record<string, string> }): Promise<CreatedOrder> {
    const order = await this.client.orders.create({
      amount: input.amountMinorUnits,
      currency: input.currency,
      receipt: input.receipt.slice(0, 40),
      notes: input.notes,
    });
    return {
      id: order.id,
      amount: Number(order.amount),
      currency: order.currency,
      receipt: order.receipt ?? input.receipt,
      status: order.status,
      created_at: order.created_at,
      notes: input.notes,
      mock: false,
    };
  }
}

/** Used when RAZORPAY_KEY_ID/SECRET are unset so the demo still completes offline. */
export class MockProvider implements PaymentProvider {
  readonly name = "mock";
  async createOrder(input: { amountMinorUnits: number; currency: string; receipt: string; notes?: Record<string, string> }): Promise<CreatedOrder> {
    return {
      id: `order_mock_${Math.random().toString(36).slice(2, 12)}`,
      amount: input.amountMinorUnits,
      currency: input.currency,
      receipt: input.receipt,
      status: "created",
      created_at: Math.floor(Date.now() / 1000),
      notes: input.notes,
      mock: true,
    };
  }
}

/** A provider that always throws — for tests and for demoing the "never partially proceed" path. */
export class FailingProvider implements PaymentProvider {
  readonly name = "failing";
  async createOrder(): Promise<CreatedOrder> {
    throw new Error("simulated provider outage");
  }
}

export function providerFromEnv(): PaymentProvider {
  const id = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (id && secret) {
    log("BOOT", "payments: Razorpay (test mode) configured", { keyId: id.slice(0, 12) + "…" });
    return new RazorpayProvider(id, secret);
  }
  log("BOOT", "payments: RAZORPAY_KEY_ID/SECRET unset → using mock order provider");
  return new MockProvider();
}
