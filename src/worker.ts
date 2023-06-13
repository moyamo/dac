import { Buffer } from "node:buffer";

import * as Itty from "itty-router";

import * as Paypal from "./paypalTypes";
import { getInvalidAmountError } from "./common";

/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `wrangler dev src/index.ts` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `wrangler publish src/index.ts --name my-worker` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

// There doesn't seem to be any compile time check that these env vars will
// correspond at runtime to what is declare here, so putting `?` is necessary.
export interface Env {
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_APP_SECRET?: string;
  FRONTEND_URL?: string;
  COUNTER?: DurableObjectNamespace;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    const router = Itty.Router();
    const corsOrigin =
      typeof env.FRONTEND_URL != "undefined" ? env.FRONTEND_URL : null;
    let corsTransform;
    if (corsOrigin) {
      const { preflight, corsify } = Itty.createCors({
        origins: [corsOrigin],
        methods: ["GET", "HEAD", "POST", "OPTIONS", "PATCH"],
        maxAge: 86400,
      });
      router.all("*", preflight);
      corsTransform = corsify;
    }

    router.post("/contract", async (req) => {
      const jsonBody = await req.json<{ amount: number }>();
      const amount = Number(jsonBody.amount.toFixed(2));
      const error = getInvalidAmountError(amount);
      if (error != null) {
        return Itty.error(400, { error });
      }
      const order = await createOrder(amount.toFixed(2), env);
      console.log(order);
      return order;
    });

    router.patch("/contract/:orderID", async (req) => {
      const orderID: string = req.params.orderID;
      const response = await capturePayment(orderID, env);
      console.log(JSON.stringify(response, null, 2));
      const returnAddress = response.payment_source.paypal.email_address;
      // TODO Error handling
      const amount = Number(
        response.purchase_units[0].payments.captures[0].amount.value
      );
      const obj = Counter.fromName(env, "demoProject");
      await obj.fetch(request.url, {
        method: "PUT",
        body: JSON.stringify({ returnAddress, amount }),
      });
      return response;
    });

    router.get("/counter", async () => {
      const obj = Counter.fromName(env, "demoProject");
      const resp = await obj.fetch(request.url, { method: "GET" });
      const count = await resp.json<number>();
      return count;
    });

    router.all("/refund", async () => {
      const obj = Counter.fromName(env, "demoProject");
      const resp = await obj.fetch(request.url, { method: request.method });
      return resp;
    });

    router.all("*", () => Itty.error(404));

    let response = router.handle(request).then(Itty.json).catch(Itty.error);
    if (corsTransform) {
      response = response.then(corsTransform);
    }
    return response;
  },
};

type PutContractBody = {
  returnAddress: string;
  amount: number;
};

export type CounterResponse = {
  amount: number;
};

// Durable Object

export class Counter implements DurableObject {
  state: DurableObjectState;
  env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  static fromName(env: Env, name: string) {
    if (typeof env.COUNTER != "undefined") {
      return env.COUNTER.get(env.COUNTER.idFromName(name));
    } else {
      throw Error("Durable Object COUNTER not bound");
    }
  }

  // Handle HTTP requests from clients.
  async fetch(request: Request) {
    // Durable Object storage is automatically cached in-memory, so reading the
    // same key every request is fast. (That said, you could also store the
    // value in a class member if you prefer.)

    type Order = { returnAddress: string; amount: number };
    type OrderMap = { [orderId: string]: Order };
    const orderMap: OrderMap = (await this.state.storage.get("orderMap")) || {};

    const router = Itty.Router();

    router.get("/counter", () => {
      return {
        amount: Object.values(orderMap).reduce(
          (total, o) => total + o.amount,
          0
        ),
      };
    });

    router.put("/contract/:orderId", async (req) => {
      const orderId: string = req.params.orderId;
      const body = await request.json<PutContractBody>();
      orderMap[orderId] = {
        returnAddress: body.returnAddress,
        amount: body.amount,
      };
      await this.state.storage.put("orderMap", orderMap);
      return "";
    });

    router.put("/refund", async () => {
      let refund = await this.state.storage.get<string>("refund");
      if (refund == null) {
        refund = crypto.randomUUID();
        const response = await payout(
          this.env,
          refund,
          Object.values(orderMap).map((o: Order) => o.returnAddress)
        );
        console.log(JSON.stringify(response));
        await this.state.storage.put("refund", refund);
      }
      return refund;
    });

    router.get("/refund", async () => {
      const refund = await this.state.storage.get("refund");
      if (refund != null) {
        return "";
      }
    });

    router.all("*", () => Itty.error(404));

    return router.handle(request).then(Itty.json).catch(Itty.error);
  }
}

// For a fully working example, please see:
// https://github.com/paypal-examples/docs-examples/tree/main/standard-integration

export const baseURL = {
  sandbox: "https://api-m.sandbox.paypal.com",
  production: "https://api-m.paypal.com",
};

/// ///////////////////
// PayPal API helpers
/// ///////////////////

export type CreateOrderResponse = {
  id: string;
};

// use the orders api to create an order
export async function createOrder(
  amountUsd: string,
  env: Env
): Promise<CreateOrderResponse> {
  const accessToken = await generateAccessToken(env);
  const url = `${baseURL.sandbox}/v2/checkout/orders`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: {
            currency_code: "USD",
            value: amountUsd,
          },
        },
      ],
    }),
  });
  const data = await response.json<CreateOrderResponse>();
  return data;
}

// use the orders api to capture payment for an order
export async function capturePayment(
  orderId: string,
  env: Env
): Promise<Paypal.CapturePaymentResponse> {
  const accessToken = await generateAccessToken(env);
  const url = `${baseURL.sandbox}/v2/checkout/orders/${orderId}/capture`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const data = await response.json<Paypal.CapturePaymentResponse>();
  return data;
}

function trace<T>(b: T): T {
  console.log(b);
  return b;
}

// use the payout api to payout to users
export async function payout(
  env: Env,
  batch_id: string,
  user_emails: string[]
) {
  const accessToken = await generateAccessToken(env);
  const url = `${baseURL.sandbox}/v1/payments/payouts`;
  const amount = "22.80"; // 19 * 120%
  const max_digit = 5; // at most 15000 payments in a single payout
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(
      trace({
        sender_batch_header: {
          sender_batch_id: batch_id,
          recipient_type: "EMAIL",
          email_subject: "DAC Demo Gratitude",
          email_message:
            "Sorry, we did not reach our funding goal we have returned you money with something extra for supporting us.",
        },
        items: user_emails.map((email, i) => ({
          amount: {
            value: amount,
            currency: "USD",
          },
          sender_item_id: batch_id + String(i).padStart(max_digit, "0"),
          recipient_wallet: "PAYPAL",
          receiver: email,
        })),
      })
    ),
  });
  if (!response.ok) {
    console.log("error");
    console.log(await response.text());
    throw new Error(`Error from Paypal API ${response.status}`);
  }
  return await response.json();
}

// generate an access token using client id and app secret
export async function generateAccessToken(env: Env): Promise<string> {
  if (
    typeof env.PAYPAL_CLIENT_ID == "undefined" ||
    typeof env.PAYPAL_APP_SECRET == "undefined"
  ) {
    throw new TypeError("PAYPAL_CLIENT_ID or PAYPAL_APP_SECRET is void");
  }
  const auth = Buffer.from(
    env.PAYPAL_CLIENT_ID + ":" + env.PAYPAL_APP_SECRET
  ).toString("base64");
  const response = await fetch(`${baseURL.sandbox}/v1/oauth2/token`, {
    method: "POST",
    body: "grant_type=client_credentials",
    headers: {
      Authorization: `Basic ${auth}`,
    },
  });
  if (!response.ok) {
    const e: { error: string; error_description: string } =
      await response.json();
    throw Error(`${e.error}: ${e.error_description}`);
  }
  const data: { access_token: string } = await response.json();
  return data.access_token;
}
