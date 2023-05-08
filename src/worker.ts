/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `wrangler dev src/index.ts` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `wrangler publish src/index.ts --name my-worker` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

interface Env {
  PAYPAL_CLIENT_ID: string;
  PAYPAL_APP_SECRET: string;
  FRONTEND_URL: string;
  COUNTER: DurableObjectNamespace;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext // eslint-disable-line @typescript-eslint/no-unused-vars
  ): Promise<Response> {
    const corsHeaders = {
      "Access-Control-Allow-Origin": env.FRONTEND_URL,
      "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS,PATCH",
      "Access-Control-Max-Age": "86400",
    };
    const url = new URL(request.url);
    console.log(request.url, request.method, url.pathname);
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    } else if (request.method === "POST" && url.pathname === "/contract") {
      console.log("got request");
      const order = await createOrder("19.00", env);
      console.log("asked paypal for request");
      console.log(order);
      return new Response(JSON.stringify(order), {
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    } else if (
      request.method == "PATCH" &&
      url.pathname.startsWith("/contract/") &&
      url.pathname.split("/").length == 3
    ) {
      const orderID = url.pathname.split("/")[2];
      const response = await capturePayment(orderID, env);
      console.log(JSON.stringify(response, null, 2));
      const returnAddress = response.payment_source.paypal.email_address;
      const obj = Counter.fromName(env, "demoProject");
      await obj.fetch(request.url, {
        method: "PUT",
        body: JSON.stringify({ returnAddress }),
      });
      return new Response(JSON.stringify(response), {
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    } else if (request.method == "GET" && url.pathname === "/counter") {
      const obj = Counter.fromName(env, "demoProject");
      const resp = await obj.fetch(request.url, { method: "GET" });
      const count = await resp.text();
      return new Response(count, { headers: corsHeaders });
    } else if (url.pathname == "/refund") {
      const obj = Counter.fromName(env, "demoProject");
      const resp = await obj.fetch(request.url, { method: request.method });
      return new Response(resp.body, {
        status: resp.status,
        headers: { ...corsHeaders, ...resp.headers },
      });
    } else {
      return new Response(null, {
        headers: corsHeaders,
        status: "404",
        statusText: "Not Found",
      });
    }
  },
};

type PutContractBody = {
  returnAddress: string;
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
    return env.COUNTER.get(env.COUNTER.idFromName(name));
  }

  // Handle HTTP requests from clients.
  async fetch(request: Request) {
    // Durable Object storage is automatically cached in-memory, so reading the
    // same key every request is fast. (That said, you could also store the
    // value in a class member if you prefer.)
    const returnAddressList =
      (await this.state.storage.get<{ string: string }>("returnAddressList")) ||
      {};
    console.log(returnAddressList);
    const path = new URL(request.url).pathname;
    const method = request.method;
    console.log("Counter", method, path);
    if (path === "/counter" && method === "GET") {
      return new Response(String(Object.keys(returnAddressList).length));
    } else if (
      path.startsWith("/contract/") &&
      path.split("/").length == 3 &&
      method == "PUT"
    ) {
      const orderId = path.split("/")[2];
      const body = await request.json<PutContractBody>();
      returnAddressList[orderId] = body.returnAddress;
      console.log(returnAddressList);
      await this.state.storage.put("returnAddressList", returnAddressList);
      return new Response();
    } else if (path == "/refund" && method == "PUT") {
      let refund = await this.state.storage.get("refund");
      if (refund == null) {
        refund = crypto.randomUUID();
        const response = await payout(
          this.env,
          refund,
          Object.values(returnAddressList)
        );
        console.log(JSON.stringify(response));
        await this.state.storage.put("refund", refund);
      }
      return new Response(refund);
    } else if (path == "/refund" && method == "GET") {
      const refund = await this.state.storage.get("refund");
      if (refund != null) {
        return new Response();
      }
    }
    return new Response("Not found", { status: 404 });
  }
}

// For a fully working example, please see:
// https://github.com/paypal-examples/docs-examples/tree/main/standard-integration

const baseURL = {
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
async function createOrder(
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
  const data = await response.json();
  return data;
}

type CapturePaymentResponse = {
  payment_source: { paypal: { email_address: string } };
};

// use the orders api to capture payment for an order
async function capturePayment(
  orderId: string,
  env: Env
): Promise<CapturePaymentResponse> {
  const accessToken = await generateAccessToken(env);
  const url = `${baseURL.sandbox}/v2/checkout/orders/${orderId}/capture`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const data = await response.json();
  return data;
}

function trace<T>(b: T): T {
  console.log(b);
  return b;
}

// use the payout api to payout to users
async function payout(env: Env, batch_id: string, user_emails: string[]) {
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
    console.log(await response.json());
    throw new Error(`Error from Paypal API ${response.status}`);
  }
  return await response.json();
}

// generate an access token using client id and app secret
async function generateAccessToken(env: Env): Promise<string> {
  const auth = btoa(env.PAYPAL_CLIENT_ID + ":" + env.PAYPAL_APP_SECRET);
  const response = await fetch(`${baseURL.sandbox}/v1/oauth2/token`, {
    method: "POST",
    body: "grant_type=client_credentials",
    headers: {
      Authorization: `Basic ${auth}`,
    },
  });
  const data: { access_token: string } = await response.json();
  return data.access_token;
}
