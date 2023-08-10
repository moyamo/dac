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
  CounterResponse,
  refundCapture,
  withAdmin,
  Bonus,
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

describe("withAdmin", () => {
  it("asks to authenticate when unauthenticated", () => {
    env.ADMIN_PASSWORD = "correct horse battery staples";
    const r = withAdmin(new Request("http://localhost/test"), env);
    if (typeof r == "undefined") {
      // help the typechecker out
      expect(r).toBeDefined();
    } else {
      expect(r.status).toBe(401);
      expect(r.headers.get("WWW-Authenticate")).toBe("Basic");
    }
  });
  it("does nothing when authenticated", () => {
    env.ADMIN_PASSWORD = "correct horse battery staples";
    const encodedUsernameAndPassword = Buffer.from(
      `admin:correct horse battery staples`
    ).toString("base64");
    const r = withAdmin(
      new Request("http://localhost/test", {
        headers: { Authorization: `Basic ${encodedUsernameAndPassword}` },
      }),
      env
    );
    expect(r).toBeUndefined();
  });
  it("fails closed on empty password", () => {
    env.ADMIN_PASSWORD = "";
    const encodedUsernameAndPassword = Buffer.from(`admin:`).toString("base64");
    const r = withAdmin(
      new Request("http://localhost/test", {
        headers: { Authorization: `Basic ${encodedUsernameAndPassword}` },
      }),
      env
    );
    if (typeof r == "undefined") {
      // help the typechecker out
      expect(r).toBeDefined();
    } else {
      expect(r.status).toBe(401);
      expect(r.headers.get("WWW-Authenticate")).toBe("Basic");
    }
  });
  it("fails closed on undefined password", () => {
    delete env.ADMIN_PASSWORD;
    const encodedUsernameAndPassword =
      Buffer.from(`admin:undefined`).toString("base64");
    const r = withAdmin(
      new Request("http://localhost/test", {
        headers: { Authorization: `Basic ${encodedUsernameAndPassword}` },
      }),
      env
    );
    if (typeof r == "undefined") {
      // help the typechecker out
      expect(r).toBeDefined();
    } else {
      expect(r.status).toBe(401);
      expect(r.headers.get("WWW-Authenticate")).toBe("Basic");
    }
  });
  it("fails when username is incorrect", () => {
    env.ADMIN_PASSWORD = "correct horse battery staples";
    const encodedUsernameAndPassword = Buffer.from(
      `incorrect_user_name:correct horse battery staples`
    ).toString("base64");
    const r = withAdmin(
      new Request("http://localhost/test", {
        headers: { Authorization: `Basic ${encodedUsernameAndPassword}` },
      }),
      env
    );
    if (typeof r == "undefined") {
      // help the typechecker out
      expect(r).toBeDefined();
    } else {
      expect(r.status).toBe(401);
      expect(r.headers.get("WWW-Authenticate")).toBe("Basic");
    }
  });
  it("fails when password is incorrect", () => {
    env.ADMIN_PASSWORD = "correct horse battery staples";
    const encodedUsernameAndPassword = Buffer.from(
      `admin:incorrect horse battery staples`
    ).toString("base64");
    const r = withAdmin(
      new Request("http://localhost/test", {
        headers: { Authorization: `Basic ${encodedUsernameAndPassword}` },
      }),
      env
    );
    if (typeof r == "undefined") {
      // help the typechecker out
      expect(r).toBeDefined();
    } else {
      expect(r.status).toBe(401);
      expect(r.headers.get("WWW-Authenticate")).toBe("Basic");
    }
  });
  it("fails when authentication header is malformed", () => {
    env.ADMIN_PASSWORD = "correct horse battery staples";
    const encodedUsernameAndPassword = Buffer.from(
      `admin:correct horse battery staples`
    ).toString("base64");
    const r = withAdmin(
      new Request("http://localhost/test", {
        headers: { Authorization: `NotBasic ${encodedUsernameAndPassword}` },
      }),
      env
    );
    if (typeof r == "undefined") {
      // help the typechecker out
      expect(r).toBeDefined();
    } else {
      expect(r.status).toBe(401);
      expect(r.headers.get("WWW-Authenticate")).toBe("Basic");
    }
  });
  it("fails when username and password not encoded properly", () => {
    env.ADMIN_PASSWORD = "correct horse battery staples";
    const encodedUsernameAndPassword = `admin:correct horse battery staples`;
    const r = withAdmin(
      new Request("http://localhost/test", {
        headers: { Authorization: `Basic ${encodedUsernameAndPassword}` },
      }),
      env
    );
    if (typeof r == "undefined") {
      // help the typechecker out
      expect(r).toBeDefined();
    } else {
      expect(r.status).toBe(401);
      expect(r.headers.get("WWW-Authenticate")).toBe("Basic");
    }
  });
});

describe("Paypal Authenticated API", () => {
  beforeEach(() => {
    env.PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || "valid_client_id";
    env.PAYPAL_APP_SECRET = process.env.PAYPAL_APP_SECRET || "valid_app_secret";
    // default to the future for most tests
    const future = new Date();
    future.setHours(future.getHours() + 24);
    env.FUNDING_DEADLINE = future.toISOString();
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
          givenName: "James",
          surname: "Smith",
        }),
      });
      // Finally, capture payment
      const r = await capturePayment(orderId, env);
      expect(r.payment_source.paypal.email_address).toBe(
        "testemail@example.com"
      );
      expect(r.payment_source.paypal.name.given_name).toBe("James");
      expect(r.payment_source.paypal.name.surname).toBe("Smith");
    });
  });

  describe("refundCapture", () => {
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
          givenName: "James",
          surname: "Smith",
        }),
      });
      // Capture payment
      const captureResponse = await capturePayment(orderId, env);
      const captureId =
        captureResponse.purchase_units[0].payments.captures[0].id;
      // Finally refund capture
      const r = await refundCapture(captureId, env);
      expect(r.id.length).toBeGreaterThan(1);
      expect(r.status).toBe("COMPLETED");
    });
  });

  describe("Counter", () => {
    describe("GET /counter", () => {
      it("returns 0 when uninitialized", async () => {
        const counter = Counter.fromName(env, "test");
        const response = await counter.fetch("http://localhost/counter");
        const responseJson = await response.json<CounterResponse>();
        expect(responseJson.amount).toBe(0);
        expect(responseJson.orders).toHaveLength(0);
      });
      it("defaults to a funding deadline in the past when not set", async () => {
        delete env.FUNDING_DEADLINE;
        const counter = Counter.fromName(env, "test");
        const response = await counter.fetch("http://localhost/counter");
        const responseJson = await response.json<CounterResponse>();
        expect(new Date(responseJson.fundingDeadline) < new Date()).toBe(true);
      });
      it("returns the funding deadline", async () => {
        const now = new Date();
        const future = new Date();
        future.setHours(now.getHours() + 1);
        env.FUNDING_DEADLINE = future.toISOString();
        const counter = Counter.fromName(env, "test");
        const response = await counter.fetch("http://localhost/counter");
        const responseJson = await response.json<CounterResponse>();
        expect(responseJson.fundingDeadline).toBe(future.toISOString());
      });
      it("returns the funding goal", async () => {
        env.FUNDING_GOAL = "303";
        const counter = Counter.fromName(env, "test");
        const response = await counter.fetch("http://localhost/counter");
        const responseJson = await response.json<CounterResponse>();
        expect(responseJson.fundingGoal).toBe(303);
      });
    });
    describe("PUT /contract/:contract", () => {
      it("add an $11 contract", async () => {
        const counter = Counter.fromName(env, "test");

        await counter.fetch("http://localhost/contract/contractOne", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            returnAddress: "email_address",
            amount: 11,
            name: "John Doe",
            time: "2023-01-01T01:01:01.000Z",
          }),
        });

        const response2 = await counter.fetch("http://localhost/counter");
        const response2Json = await response2.json<CounterResponse>();
        expect(response2Json.amount).toBe(11);
        expect(response2Json.orders).toHaveLength(1);
        expect(response2Json.orders[0].name).toBe("John D.");
        expect(response2Json.orders[0].amount).toBe(11);
        expect(response2Json.orders[0].time).toBe("2023-01-01T01:01:01.000Z");
      });
      it("add an $11 contract and $32 contract", async () => {
        const counter = Counter.fromName(env, "test");

        await counter.fetch("http://localhost/contract/contractOne", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email_address: "exampleOne@example.com",
            amount: 11,
            name: "John Doe",
            time: "2023-01-03T01:01:01.000Z",
          }),
        });

        await counter.fetch("http://localhost/contract/contractTwo", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email_address: "exampleTwo@example.com",
            amount: 32,
            name: "James Smith",
            time: "2023-01-04T02:02:02.000Z",
          }),
        });

        const response3 = await counter.fetch("http://localhost/counter");
        const response3Json = await response3.json<CounterResponse>();
        expect(response3Json.amount).toBe(43);
        expect(response3Json.orders).toHaveLength(2);
        expect(response3Json.orders[0].name).toBe("John D.");
        expect(response3Json.orders[0].amount).toBe(11);
        expect(response3Json.orders[0].time).toBe("2023-01-03T01:01:01.000Z");
        expect(response3Json.orders[1].name).toBe("James S.");
        expect(response3Json.orders[1].amount).toBe(32);
        expect(response3Json.orders[1].time).toBe("2023-01-04T02:02:02.000Z");
      });
      it("to be idempotent", async () => {
        const counter = Counter.fromName(env, "test");

        await counter.fetch("http://localhost/contract/contractOne", {
          method: "PUT",
          body: JSON.stringify({
            email_address: "exampleOne@example.com",
            amount: 11,
            name: "John Doe",
            time: "2023-01-04T02:02:02.000Z",
          }),
          headers: {
            "Content-Type": "application/json",
          },
        });

        // Updating the same contract shouldn't increase the count.
        await counter.fetch("http://localhost/contract/contractOne", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email_address: "exampleTwo@example.com",
            amount: 11,
            name: "John Doe",
            time: "2023-01-04T02:02:02.000Z",
          }),
        });

        const response3 = await counter.fetch("http://localhost/counter");
        const response3Json = await response3.json<CounterResponse>();
        expect(response3Json.amount).toBe(11);
      });
    });
    describe("/refunds", () => {
      beforeEach(async () => {
        const counter = Counter.fromName(env, "test");
        await counter.fetch("http://localhost/contract/contractOne", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email_address: "exampleOne@example.com",
            amount: 11,
            captureId: "ABC0",
            refunded: false,
            name: "John Doe",
            time: "2023-01-03T01:01:01.000Z",
          }),
        });

        await counter.fetch("http://localhost/contract/contractTwo", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email_address: "exampleTwo@example.com",
            amount: 32,
            captureId: "ABC1",
            refunded: false,
            name: "James Smith",
            time: "2023-01-04T02:02:02.000Z",
          }),
        });
      });
      it("no refunds before deadline", async () => {
        const counter = Counter.fromName(env, "test");
        const response = await counter.fetch("http://localhost/refunds");
        expect(response.status).toBe(404);
      });
      it("has list of refunds after deadline has passed", async () => {
        env.FUNDING_DEADLINE = "2023-01-01T01:01:01Z";
        const counter = Counter.fromName(env, "test");
        const response = await counter.fetch("http://localhost/refunds");
        expect(response.ok).toBeTruthy();
        const responseJson = await response.json<{ captureIds: string[] }>();
        expect(responseJson.captureIds).toHaveLength(2);
      });
      it("can delete a refund", async () => {
        env.FUNDING_DEADLINE = "2023-01-01T01:01:01Z";
        const counter = Counter.fromName(env, "test");
        const response = await counter.fetch("http://localhost/refunds");
        expect(response.ok).toBeTruthy();
        const responseJson = await response.json<{ captureIds: string[] }>();
        expect(responseJson.captureIds).toHaveLength(2);
        const captureId0 = responseJson.captureIds[0];
        await counter.fetch(`http://localhost/refunds/${captureId0}`, {
          method: "DELETE",
        });
        const response2 = await counter.fetch("http://localhost/refunds");
        expect(response2.ok).toBeTruthy();
        const response2Json = await response2.json<{ captureIds: string[] }>();
        expect(response2Json.captureIds).toHaveLength(1);
      });
      it("no refund if deadline passed but project fully funded", async () => {
        env.FUNDING_DEADLINE = "2023-01-01T01:01:01Z";
        env.FUNDING_GOAL = "100";
        const counter = Counter.fromName(env, "test");
        await counter.fetch("http://localhost/contract/contractTwo", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email_address: "exampleThree@example.com",
            amount: 100,
            captureId: "ABC3",
            refunded: false,
            name: "James Fully Funder",
            time: "2023-01-07T02:02:02.000Z",
          }),
        });
        const response = await counter.fetch("http://localhost/refunds");
        expect(response.status).toBe(404);
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
        new Request("http://localhost/", {
          method: "OPTIONS",
          headers: {
            Origin: env.FRONTEND_URL,
          },
        }),
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
      it("fails with incorrect body", async () => {
        const response = await worker.fetch(
          new Request("http://localhost/contract", {
            method: "POST",
            body: JSON.stringify({ notAmount: 1123.0 }),
          }),
          env,
          ctx
        );
        expect(response.ok).toBeFalsy();
      });
      it("fails with amount greater than 500", async () => {
        const response = await worker.fetch(
          new Request("http://localhost/contract", {
            method: "POST",
            body: JSON.stringify({ amount: 501 }),
          }),
          env,
          ctx
        );
        expect(response.ok).toBeFalsy();
      });
      it("fails with amount less than 5", async () => {
        const response = await worker.fetch(
          new Request("http://localhost/contract", {
            method: "POST",
            body: JSON.stringify({ amount: 4 }),
          }),
          env,
          ctx
        );
        expect(response.ok).toBeFalsy();
      });
      it("fails when deadline has passed", async () => {
        env.FUNDING_DEADLINE = "2023-01-01T00:00:00Z";
        const response = await worker.fetch(
          new Request("http://localhost/contract", {
            method: "POST",
            body: JSON.stringify({ amount: 10 }),
          }),
          env,
          ctx
        );
        expect(response.ok).toBeFalsy();
      });
      it("works with correct body", async () => {
        const response = await worker.fetch(
          new Request("http://localhost/contract", {
            method: "POST",
            body: JSON.stringify({ amount: 17.0 }),
          }),
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
          new Request("http://localhost/contract", {
            method: "POST",
            body: JSON.stringify({ amount: 17.0 }),
          }),
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
        const responseJson = await response.json<CounterResponse>();
        expect(responseJson.amount).toBe(0);
        expect(responseJson.orders).toHaveLength(0);
      });
      it("increases by 13 after you create a contract worth 13", async () => {
        const response = await worker.fetch(
          new Request("http://localhost/contract", {
            method: "POST",
            body: JSON.stringify({ amount: 15 }),
          }),
          env,
          ctx
        );
        const orderId = (await response.json<Paypal.CreateOrderResponse>()).id;

        await fetch(`${baseURL.sandbox}/mock/approve`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: "testemail@example.com",
            orderId: orderId,
            givenName: "John",
            surname: "Doe",
          }),
        });

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
        const response3Json = await response3.json<CounterResponse>();
        expect(response3Json.amount).toBe(15);
        expect(response3Json.orders).toHaveLength(1);
        expect(response3Json.orders[0].name).toBe("John D.");
        expect(response3Json.orders[0].amount).toBe(15);
      });
    });
    describe("Admin API", () => {
      describe("Failing when unauthenticated", () => {
        it("POST /refund", async () => {
          const response = await worker.fetch(
            new Request("http://localhost/refund", { method: "POST" }),
            env,
            ctx
          );
          expect(response.status).toBe(401);
          expect(response.headers.get("WWW-Authenticate")).toBe("Basic");
        });
        it("GET /bonuses", async () => {
          const response = await worker.fetch(
            new Request("http://localhost/bonuses", { method: "GET" }),
            env,
            ctx
          );
          expect(response.status).toBe(401);
          expect(response.headers.get("WWW-Authenticate")).toBe("Basic");
        });
        it("DELETE /bonuses/whatever", async () => {
          const response = await worker.fetch(
            new Request("http://localhost/bonuses/whatever", {
              method: "DELETE",
            }),
            env,
            ctx
          );
          expect(response.status).toBe(401);
          expect(response.headers.get("WWW-Authenticate")).toBe("Basic");
        });
      });
      describe("Authenticated", () => {
        let headers = {};
        beforeEach(() => {
          env.ADMIN_PASSWORD = "correct horse battery staples";
          const encodedUsernameAndPassword = Buffer.from(
            "admin:correct horse battery staples"
          ).toString("base64");
          headers = { Authorization: `Basic ${encodedUsernameAndPassword}` };
        });
        describe("/refund", () => {
          it("POST is initially 404", async () => {
            const response = await worker.fetch(
              new Request("http://localhost/refund", {
                method: "POST",
                headers,
              }),
              env,
              ctx
            );
            expect(response.status).toBe(404);
          });
          it("POST is 404 until deadline passes then 404 again after all refunds complete", async () => {
            const response = await worker.fetch(
              new Request("http://localhost/contract", {
                method: "POST",
                body: JSON.stringify({ amount: 15 }),
              }),
              env,
              ctx
            );
            const orderId = (await response.json<Paypal.CreateOrderResponse>())
              .id;

            await fetch(`${baseURL.sandbox}/mock/approve`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                email: "testemail@example.com",
                orderId: orderId,
                givenName: "John",
                surname: "Doe",
              }),
            });

            await worker.fetch(
              new Request(`http://localhost/contract/${orderId}`, {
                method: "PATCH",
              }),
              env,
              ctx
            );
            const response3 = await worker.fetch(
              new Request("http://localhost/refund", {
                method: "POST",
                headers,
              }),
              env,
              ctx
            );
            expect(response3.status).toBe(404);
            env.FUNDING_DEADLINE = "2023-01-01T01:01:01Z";
            const response4 = await worker.fetch(
              new Request("http://localhost/refund", {
                method: "POST",
                headers,
              }),
              env,
              ctx
            );
            expect(response4.status).toBe(201);
            const response4Json = await response4.json<{ refundId: string }>();
            expect(response4Json.refundId.length).toBeGreaterThanOrEqual(1);
            const response5 = await worker.fetch(
              new Request("http://localhost/refund", {
                method: "POST",
                headers,
              }),
              env,
              ctx
            );
            expect(response5.status).toBe(404);
          });
        });
        it("GET /bonuses", async () => {
          const response = await worker.fetch(
            new Request("http://localhost/contract", {
              method: "POST",
              body: JSON.stringify({ amount: 15 }),
            }),
            env,
            ctx
          );
          const orderId = (await response.json<Paypal.CreateOrderResponse>())
            .id;

          await fetch(`${baseURL.sandbox}/mock/approve`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              email: "testemail@example.com",
              orderId: orderId,
              givenName: "John",
              surname: "Doe",
            }),
          });

          await worker.fetch(
            new Request(`http://localhost/contract/${orderId}`, {
              method: "PATCH",
            }),
            env,
            ctx
          );
          const response3 = await worker.fetch(
            new Request("http://localhost/bonuses", { method: "GET", headers }),
            env,
            ctx
          );
          expect(response3.status).toBe(404);
          env.FUNDING_DEADLINE = "2023-01-01T01:01:01Z";
          const response4 = await worker.fetch(
            new Request("http://localhost/bonuses", { method: "GET", headers }),
            env,
            ctx
          );
          expect(response4.status).toBe(200);
          const response4Json = await response4.json<{
            bonuses: Record<string, Bonus>;
          }>();
          expect(Object.keys(response4Json.bonuses)).toHaveLength(1);
          expect(response4Json.bonuses[orderId].amount).toBe(3);
          expect(response4Json.bonuses[orderId].email).toBe(
            "testemail@example.com"
          );

          const response5 = await worker.fetch(
            new Request(`http://localhost/bonuses/${orderId}`, {
              method: "DELETE",
              headers,
            }),
            env,
            ctx
          );
          expect(response5.status).toBe(200);
          const response6 = await worker.fetch(
            new Request("http://localhost/bonuses", { method: "GET", headers }),
            env,
            ctx
          );
          expect(response6.status).toBe(404);
        });
      });
    });
  });
});
