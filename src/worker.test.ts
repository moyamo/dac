/**
 * @jest-environment miniflare
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import _declareGlobalThis from "jest-environment-miniflare/globals";

import paypalMock from "./paypalMock";
import * as Paypal from "./paypalTypes";

import worker, {
  Env,
  generateAccessToken,
  payout,
  createOrder,
  baseURL,
  capturePayment,
  Counter,
} from "./worker";

let env: Env;
// reset before every test.
beforeEach(() => {
  env = getMiniflareBindings();
});

beforeEach(() => {
  paypalMock();
});

describe("generateAccessToken", () => {
  it("throws TypeError when PAYPAL_CLIENT_ID or PAYPAL_APP_SECRET undefined", async () => {
    delete env.PAYPAL_APP_SECRET;
    delete env.PAYPAL_CLIENT_ID;
    await expect(generateAccessToken.bind(null, env)).rejects.toThrow(
      TypeError
    );
  });
  it("throws error with invalid credentials", async () => {
    env.PAYPAL_CLIENT_ID = "invalid";
    env.PAYPAL_APP_SECRET = "invalid";
    await expect(generateAccessToken.bind(null, env)).rejects.toThrow(
      "invalid_client: Client Authentication failed"
    );
  });
  it("returns Bearer token when credentials valid", async () => {
    env.PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || "valid_client_id";
    env.PAYPAL_APP_SECRET = process.env.PAYPAL_APP_SECRET || "valid_app_secret";
    expect(await generateAccessToken(env)).toBe("VALIDACCESSTOKEN");
  });
});

describe("Authenticated API", () => {
  beforeEach(() => {
    env.PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || "valid_client_id";
    env.PAYPAL_APP_SECRET = process.env.PAYPAL_APP_SECRET || "valid_app_secret";
  });

  describe("payout", () => {
    it("works", async () => {
      const r = (await payout(env, "batch_id", [
        "email1@example.com",
        "email2@example.com",
      ])) as { batch_header: { batch_status: string } };
      expect(r.batch_header.batch_status).toBe("PENDING");
    });
    it("fails with malformed email", async () => {
      await expect(
        payout(env, "batch_id", ["<email1@example.com>"])
      ).rejects.toThrow("Error from Paypal API 400");
    });
  });

  describe("createOrder", () => {
    it("works", async () => {
      const response = await createOrder("10.00", env);
      expect(typeof response.id).toBe("string");
      expect(response.id.length).toBeGreaterThan(0);
    });
  });

  describe("capturePayment", () => {
    it("works", async () => {
      // Create order
      const response = await createOrder("10.00", env);
      const orderId = response.id;
      // Mock user approving charge
      await fetch(`${baseURL.sandbox}/mock/approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: "testemail@example.com",
          orderId: orderId,
        }),
      });
      // Finally, capture payment
      const r = await capturePayment(orderId, env);
      expect(r.payment_source.paypal.email_address).toBe(
        "testemail@example.com"
      );
    });
  });

  describe("Counter", () => {
    describe("GET /counter", () => {
      it("returns 0 when uninitialized", async () => {
        const counter = Counter.fromName(env, "test");
        const response = await counter.fetch("http://localhost/counter");
        expect(await response.text()).toBe("0");
      });
    });
    describe("PUT /contract/:contract", () => {
      it("increases the count of contracts", async () => {
        const counter = Counter.fromName(env, "test");

        await counter.fetch("http://localhost/contract/contractOne", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email_address: "email_address" }),
        });

        const response2 = await counter.fetch("http://localhost/counter");
        expect(await response2.text()).toBe("1");
      });
      it("to count to two", async () => {
        const counter = Counter.fromName(env, "test");

        await counter.fetch("http://localhost/contract/contractOne", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email_address: "exampleOne@example.com" }),
        });

        await counter.fetch("http://localhost/contract/contractTwo", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email_address: "exampleTwo@example.com" }),
        });

        const response3 = await counter.fetch("http://localhost/counter");
        expect(await response3.text()).toBe("2");
      });
      it("to be idempotent", async () => {
        const counter = Counter.fromName(env, "test");

        await counter.fetch("http://localhost/contract/contractOne", {
          method: "PUT",
          body: JSON.stringify({ email_address: "exampleOne@example.com" }),
          headers: {
            "Content-Type": "application/json",
          },
        });

        // Updating the same contract shouldn't increase the count.
        await counter.fetch("http://localhost/contract/contractOne", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email_address: "exampleTwo@example.com" }),
        });

        const response3 = await counter.fetch("http://localhost/counter");
        expect(await response3.text()).toBe("1");
      });
    });
    describe("/refund", () => {
      it("doesn't exist initially", async () => {
        const counter = Counter.fromName(env, "test");
        const response = await counter.fetch("http://localhost/refund");
        expect(response.status).toBe(404);
      });
      it("exist after refunding", async () => {
        const counter = Counter.fromName(env, "test");
        const response = await counter.fetch("http://localhost/refund", {
          method: "PUT",
        });
        // Returns an ID
        const refundId: string = await response.text();
        expect(refundId.length).toBeGreaterThan(1);

        const response2 = await counter.fetch("http://localhost/refund");
        expect(response2.ok).toBeTruthy();
      });
    });
    describe("fromName", () => {
      it("throw error when no counter in env", () => {
        expect(() => Counter.fromName({}, "test")).toThrow("COUNTER not bound");
      });
    });
  });

  describe("fetch", () => {
    const ctx = new ExecutionContext();
    it("respond with CORS headers when configured", async () => {
      env.FRONTEND_URL = "http://localcors.com";
      const response = await worker.fetch(
        new Request("http://localhost/", { method: "OPTIONS" }),
        env,
        ctx
      );
      expect(response.headers.has("Access-Control-Allow-Origin")).toBeTruthy();
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
        "http://localcors.com"
      );
    });
    it("respond without CORS headers when not configured", async () => {
      env.FRONTEND_URL = undefined;
      const response = await worker.fetch(
        new Request("http://localhost/", { method: "OPTIONS" }),
        env,
        ctx
      );
      expect(response.headers.has("Access-Control-Allow-Origin")).toBeFalsy();
    });
    describe("POST /contract", () => {
      it("works", async () => {
        const response = await worker.fetch(
          new Request("http://localhost/contract", { method: "POST" }),
          env,
          ctx
        );
        const responseBody: Paypal.CreateOrderResponse = await response.json();
        expect(typeof responseBody.id).toBe("string");
        expect(responseBody.id.length).toBeGreaterThan(1);
      });
    });
    describe("PATCH /contract/:contract_id", () => {
      it("works", async () => {
        const response = await worker.fetch(
          new Request("http://localhost/contract", { method: "POST" }),
          env,
          ctx
        );
        const responseBody: Paypal.CreateOrderResponse = await response.json();
        const orderId = responseBody.id;

        const response2 = await worker.fetch(
          new Request(`http://localhost/contract/${orderId}`, {
            method: "PATCH",
          }),
          env,
          ctx
        );
        expect(response2.ok).toBeTruthy();
      });
    });
    describe("GET /counter", () => {
      it("starts at zero", async () => {
        const response = await worker.fetch(
          new Request("http://localhost/counter", { method: "GET" }),
          env,
          ctx
        );
        expect(await response.text()).toBe("0");
      });
      it("increases by 1 after you create a contract", async () => {
        const response = await worker.fetch(
          new Request("http://localhost/contract", { method: "POST" }),
          env,
          ctx
        );
        const orderId = (await response.json<Paypal.CreateOrderResponse>()).id;

        await worker.fetch(
          new Request(`http://localhost/contract/${orderId}`, {
            method: "PATCH",
          }),
          env,
          ctx
        );
        const response3 = await worker.fetch(
          new Request("http://localhost/counter", { method: "GET" }),
          env,
          ctx
        );
        expect(await response3.text()).toBe("1");
      });
    });
    describe("/refund", () => {
      it("GET is initially 404", async () => {
        const response = await worker.fetch(
          new Request("http://localhost/refund"),
          env,
          ctx
        );
        expect(response.status).toBe(404);
      });
      it("GET is 200 after PUT", async () => {
        const response = await worker.fetch(
          new Request("http://localhost/refund", { method: "PUT" }),
          env,
          ctx
        );
        const refundId = await response.text();
        expect(refundId.length).toBeGreaterThanOrEqual(1);
        const response2 = await worker.fetch(
          new Request("http://localhost/refund"),
          env,
          ctx
        );
        expect(response2.status).toBe(200);
      });
    });
  });
});
