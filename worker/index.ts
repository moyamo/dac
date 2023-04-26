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
  PAYPAL_CLIENT_ID: string,
  PAYPAL_APP_SECRET: string,
  FRONTEND_URL: string,
  COUNTER: DurableObjectNamespace,
}

export default {
  async fetch(
	request: Request,
	env: Env,
	ctx: ExecutionContext
  ): Promise<Response> {
    const corsHeaders = {
      "Access-Control-Allow-Origin": env.FRONTEND_URL,
      "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS,PATCH",
      "Access-Control-Max-Age": "86400",
    };
    const url = new URL(request.url);
    console.log(request.url, request.method, url.pathname)
    if (request.method === "OPTIONS") {
      return new Response(null, {"headers": corsHeaders})
    } else if (request.method === "POST" && url.pathname === "/contract") {
      console.log("got request")
      const order = await createOrder("19.00", env);
      console.log("asked paypal for request")
      console.log(order)
      return new Response(JSON.stringify(order), {"headers": {...corsHeaders, "content-type": "application/json"}});
    } else if (request.method == "PATCH" && url.pathname.startsWith("/contract/") && url.pathname.split("/").length == 3) {
      const orderID = url.pathname.split("/")[2];
      const response = await capturePayment(orderID, env);
      console.log(JSON.stringify(response, null, 2))
      const obj = Counter.fromName(env, "demoProject");
      const objUrl = new URL("/counter", url.origin).href;
      console.log("objUrl", objUrl)
      obj.fetch(objUrl, {method: "POST"})
      return new Response(JSON.stringify(response), {"headers": {...corsHeaders, "content-type": "application/json"}})
    } else if (request.method == "GET" && url.pathname === "/counter") {
      const obj = Counter.fromName(env, "demoProject");
      const resp = await obj.fetch(request.url);
      const count = await resp.text();
      return new Response(count, {"headers": corsHeaders})
    } else {
      return new Response(null, {headers: corsHeaders, status: "404", statusText: "Not Found"});
    }
  },
};

// Durable Object

export class Counter {
  constructor(state, env) {
    this.state = state;
  }

  static fromName(env: Env, name: string) {
    return env.COUNTER.get(env.COUNTER.idFromName(name))
  }

  // Handle HTTP requests from clients.
  async fetch(request) {
    // Durable Object storage is automatically cached in-memory, so reading the
    // same key every request is fast. (That said, you could also store the
    // value in a class member if you prefer.)
    let value = (await this.state.storage.get("value")) || 0;

    switch (request.method) {
      case "POST":
        ++value;
        break;
      case "GET":
        // Just serve the current value.
        break;
      default:
        return new Response("Not found", { status: 404 });
    }

    // You do not have to worry about a concurrent request having modified the
    // value in storage because "input gates" will automatically protect against
    // unwanted concurrency. So, read-modify-write is safe. For more details,
    // refer to: https://blog.cloudflare.com/durable-objects-easy-fast-correct-choose-three/
    await this.state.storage.put("value", value);

    return new Response(value);
  }
}

// For a fully working example, please see:
// https://github.com/paypal-examples/docs-examples/tree/main/standard-integration

const baseURL = {
  sandbox: "https://api-m.sandbox.paypal.com",
  production: "https://api-m.paypal.com"
};

//////////////////////
// PayPal API helpers
//////////////////////

// use the orders api to create an order
async function createOrder(amountUsd: string, env: Env) {
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

// use the orders api to capture payment for an order
async function capturePayment(orderId, env) {
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

// generate an access token using client id and app secret
async function generateAccessToken(env: Env) {
  const auth = btoa(env.PAYPAL_CLIENT_ID + ":" + env.PAYPAL_APP_SECRET)
  const response = await fetch(`${baseURL.sandbox}/v1/oauth2/token`, {
    method: "POST",
    body: "grant_type=client_credentials",
    headers: {
      Authorization: `Basic ${auth}`,
    },
  });
  const data = await response.json();
  return data.access_token;
}
