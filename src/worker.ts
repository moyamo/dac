import { Buffer } from "node:buffer";

import * as Itty from "itty-router";

import * as Paypal from "./paypalTypes";
import { getInvalidAmountError, hasFundingDeadlinePassed } from "./common";

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
  PAYPAL_API_URL?: string;
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_APP_SECRET?: string;
  FRONTEND_URL?: string;
  COUNTER?: DurableObjectNamespace;
  FUNDING_DEADLINE?: string;
  FUNDING_GOAL?: string;
  ADMIN_PASSWORD?: string;
}

export function withAdmin(req: Request, env: Env) {
  const unauthorized = Itty.text("", {
    status: 401,
    headers: { "WWW-Authenticate": "Basic" },
  });
  if (!env.ADMIN_PASSWORD) return unauthorized;
  const authorization = req.headers.get("Authorization");
  if (authorization == null) return unauthorized;
  const authSplit = authorization.split(" ", 2);
  if (authSplit[0] != "Basic" || authSplit.length == 1) return unauthorized;
  const basic = Buffer.from(authSplit[1], "base64").toString("ascii");
  const basicSplit = basic.split(":", 2);
  if (basicSplit.length != 2) return unauthorized;
  const [username, password] = basicSplit;
  if (username != "admin" || password != env.ADMIN_PASSWORD)
    return unauthorized;
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
        methods: ["GET", "HEAD", "POST", "OPTIONS", "PATCH", "DELETE"],
        maxAge: 86400,
        headers: {
          "Access-Control-Allow-Credentials": true,
        },
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
      if (hasFundingDeadlinePassed(getFundingDeadline(env))) {
        return Itty.error(400, { error: "Funding deadline passed" });
      }
      const order = await createOrder(amount.toFixed(2), env);
      return order;
    });

    router.patch("/contract/:orderID", async (req) => {
      const orderID: string = req.params.orderID;
      const response = await capturePayment(orderID, env);
      if (response.purchase_units.length != 1)
        throw new Error(
          `Expected 1 purchase_unit got ${response.purchase_units.length}`
        );
      const purchase_unit = response.purchase_units[0];
      if (purchase_unit.payments.captures.length != 1)
        throw new Error(
          `Expected 1 capture got ${purchase_unit.payments.captures.length}`
        );
      const capture = purchase_unit.payments.captures[0];
      const returnAddress = response.payment_source.paypal.email_address;
      const captureId = capture.id;
      const name =
        response.payment_source.paypal.name.given_name +
        " " +
        response.payment_source.paypal.name.surname;
      const amount = Number(capture.amount.value);
      const time = new Date().toISOString();
      const obj = Counter.fromName(env, "demoProject");
      await obj.fetch(request.url, {
        method: "PUT",
        body: JSON.stringify({ returnAddress, captureId, amount, name, time }),
      });
      return Itty.json();
    });

    router.get("/counter", async () => {
      const obj = Counter.fromName(env, "demoProject");
      const resp = await obj.fetch(request.url, { method: "GET" });
      const count = await resp.json<number>();
      return count;
    });

    router.post("/refund", withAdmin, async () => {
      const obj = Counter.fromName(env, "demoProject");
      const url = new URL(request.url);
      const refunds = await obj.fetch(`${url.origin}/refunds`);
      if (!refunds.ok) {
        return Itty.error(refunds.status);
      }
      const { captureIds } = await refunds.json<{ captureIds: string[] }>();
      const captureId = captureIds[0];
      const refundResponse = await refundCapture(captureId, env);
      const deleteResponse = await obj.fetch(
        `${url.origin}/refunds/${captureId}`,
        { method: "DELETE" }
      );
      if (!deleteResponse.ok) return Itty.error(deleteResponse.status);
      return Itty.json(
        {
          refundId: refundResponse.id,
        },
        { status: 201 }
      );
    });

    router.get("/bonuses", withAdmin, (req) =>
      Counter.fromName(env, "demoProject").fetch(req.url, {
        method: req.method,
      })
    );

    router.delete("/bonuses/:orderID", withAdmin, (req) =>
      Counter.fromName(env, "demoProject").fetch(req.url, {
        method: req.method,
      })
    );

    router.all("*", () => Itty.error(404));

    let response = router
      .handle(request, env)
      .then(Itty.json)
      .catch(Itty.error);
    if (corsTransform) {
      response = response.then(corsTransform);
    }
    return response;
  },
};

type PutContractBody = {
  returnAddress: string;
  captureId: string;
  amount: number;
  name: string;
  time: string;
};

export type Order = {
  time: string;
  name: string;
  amount: number;
};

export type CounterResponse = {
  amount: number;
  orders: Order[];
  fundingDeadline: string;
  fundingGoal: number;
};

export type BonusesResponse = {
  bonuses: Record<string, Bonus>;
};

export type Bonus = {
  email: string;
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

    type InternalOrder = {
      returnAddress: string;
      captureId: string;
      refunded: boolean;
      amount: number;
      bonus: {
        amount: number;
        refunded: boolean;
      };
      name: string;
      time: string;
    };
    type OrderMap = { [orderId: string]: InternalOrder };
    const orderMap: OrderMap = (await this.state.storage.get("orderMap")) || {};

    const router = Itty.Router();

    router.get("/counter", () => {
      return {
        amount: Object.values(orderMap).reduce(
          (total, o) => total + o.amount,
          0
        ),
        orders: Object.values(orderMap).map((order) => {
          const names = order.name.split(" ");
          // It's possible that name[1] is a middle name and not a surname, but
          // I don't really care
          const anonymizedName = `${names[0]} ${names[1].slice(0, 1)}.`;
          return {
            time: order.time,
            name: anonymizedName,
            amount: order.amount,
          };
        }),
        fundingDeadline: getFundingDeadline(this.env),
        fundingGoal: getFundingGoal(this.env),
      };
    });

    router.put("/contract/:orderId", async (req) => {
      const orderId: string = req.params.orderId;
      const body = await request.json<PutContractBody>();
      orderMap[orderId] = {
        returnAddress: body.returnAddress,
        captureId: body.captureId,
        refunded: false,
        amount: body.amount,
        bonus: {
          refunded: false,
          amount: Number((body.amount * 0.2).toFixed(2)),
        },
        name: body.name,
        time: body.time,
      };
      await this.state.storage.put("orderMap", orderMap);
      return "";
    });

    router.get("/refunds", async () => {
      if (!hasFundingDeadlinePassed(getFundingDeadline(this.env))) {
        return Itty.error(404);
      }
      const orderMap: OrderMap =
        (await this.state.storage.get("orderMap")) || {};

      const totalAmount = Object.values(orderMap).reduce(
        (total, o) => total + o.amount,
        0
      );
      if (totalAmount >= getFundingGoal(this.env)) return Itty.error(404);

      const captureIds = Object.values(orderMap)
        .filter((o) => !o.refunded)
        .map((o) => o.captureId);
      if (captureIds.length == 0) {
        return Itty.error(404);
      }
      return { captureIds };
    });

    router.delete("/refunds/:captureId", async (req) => {
      const captureId: string = req.params.captureId;
      const orderMap: OrderMap =
        (await this.state.storage.get("orderMap")) || {};

      const captureToOrder = Object.fromEntries(
        Object.entries(orderMap).map(([orderId, o]) => [o.captureId, orderId])
      );

      if (!(captureId in captureToOrder)) return Itty.error(404);
      if (orderMap[captureToOrder[captureId]].refunded) return Itty.error(404);

      orderMap[captureToOrder[captureId]].refunded = true;
      await this.state.storage.put("orderMap", orderMap);
      return {};
    });

    router.get("/bonuses", async () => {
      if (!hasFundingDeadlinePassed(getFundingDeadline(this.env))) {
        return Itty.error(404);
      }
      const orderMap: OrderMap =
        (await this.state.storage.get("orderMap")) || {};

      const totalAmount = Object.values(orderMap).reduce(
        (total, o) => total + o.amount,
        0
      );
      if (totalAmount >= getFundingGoal(this.env)) return Itty.error(404);

      const bonuses = Object.fromEntries(
        Object.entries(orderMap)
          .filter(([_orderId, o]) => !o.bonus.refunded)
          .map(([orderId, o]) => [
            orderId,
            { email: o.returnAddress, amount: o.bonus.amount },
          ])
      );
      if (Object.keys(bonuses).length == 0) {
        return Itty.error(404);
      }
      return { bonuses };
    });

    router.delete("/bonuses/:orderId", async (req) => {
      const orderId: string = req.params.orderId;
      const orderMap: OrderMap =
        (await this.state.storage.get("orderMap")) || {};
      if (!(orderId in orderMap)) return Itty.error(404);
      if (orderMap[orderId].bonus.refunded) return Itty.error(404);

      orderMap[orderId].bonus.refunded = true;
      await this.state.storage.put("orderMap", orderMap);
      return {};
    });

    router.all("*", () => Itty.error(404));

    return router.handle(request).then(Itty.json).catch(Itty.error);
  }
}

function getFundingDeadline(env: Env): string {
  return typeof env.FUNDING_DEADLINE != "undefined"
    ? new Date(env.FUNDING_DEADLINE).toISOString()
    : "2023-01-01T01:01:01Z";
}

function getFundingGoal(env: Env): number {
  return typeof env.FUNDING_GOAL != "undefined"
    ? Number(env.FUNDING_GOAL)
    : 850;
}

// For a fully working example, please see:
// https://github.com/paypal-examples/docs-examples/tree/main/standard-integration

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
  if (typeof env.PAYPAL_API_URL == "undefined")
    throw new TypeError("PAYPAL_API_URL is undefined");
  const accessToken = await generateAccessToken(env);
  const url = `${env.PAYPAL_API_URL}/v2/checkout/orders`;
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
  if (typeof env.PAYPAL_API_URL == "undefined")
    throw new TypeError("PAYPAL_API_URL is undefined");
  const accessToken = await generateAccessToken(env);
  const url = `${env.PAYPAL_API_URL}/v2/checkout/orders/${orderId}/capture`;
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
  if (typeof env.PAYPAL_API_URL == "undefined")
    throw new TypeError("PAYPAL_API_URL is undefined");
  const accessToken = await generateAccessToken(env);
  const url = `${env.PAYPAL_API_URL}/v1/payments/payouts`;
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

// Use Paypal payments API to refund a capture,
export async function refundCapture(
  captureId: string,
  env: Env
): Promise<Paypal.RefundCaptureResponse> {
  if (typeof env.PAYPAL_API_URL == "undefined")
    throw new TypeError("PAYPAL_API_URL is undefined");
  const accessToken = await generateAccessToken(env);
  const url = `${env.PAYPAL_API_URL}/v2/payments/captures/${captureId}/refund`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const data = await response.json<Paypal.RefundCaptureResponse>();
  return data;
}

// generate an access token using client id and app secret
export async function generateAccessToken(env: Env): Promise<string> {
  if (typeof env.PAYPAL_CLIENT_ID == "undefined")
    throw new TypeError("PAYPAL_CLIENT_ID is undefined");
  if (typeof env.PAYPAL_APP_SECRET == "undefined")
    throw new TypeError("PAYPAL_APP_SECRET is undefined");
  if (typeof env.PAYPAL_API_URL == "undefined")
    throw new TypeError("PAYPAL_API_URL is undefined");

  const auth = Buffer.from(
    env.PAYPAL_CLIENT_ID + ":" + env.PAYPAL_APP_SECRET
  ).toString("base64");
  const response = await fetch(`${env.PAYPAL_API_URL}/v1/oauth2/token`, {
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
