/**
 * @jest-environment miniflare
 */

import crypto from "crypto";

import puppeteer from "puppeteer";

import paypalMock from "./paypalMock";
import * as Paypal from "./paypalTypes";

const baseURL = {
  sandbox: "https://api-m.sandbox.paypal.com",
};

const PAYPAL_CLIENT_ID: string =
  process.env.PAYPAL_CLIENT_ID || "ERROR NO CLIENT ID";
if (PAYPAL_CLIENT_ID == "ERROR NO CLIENT ID") {
  throw new Error("PAYPAL_CLIENT_ID not specified in environment variables");
}
const PAYPAL_APP_SECRET: string =
  process.env.PAYPAL_APP_SECRET || "ERROR NO APP SECRET";
if (PAYPAL_APP_SECRET == "ERROR NO APP SECRET") {
  throw new Error("PAYPAL_APP_SECRET not specified in environment variables");
}
const PAYPAL_SANDBOX_EMAIL_1: string =
  process.env.PAYPAL_SANDBOX_EMAIL_1 || "ERROR NO SANDBOX EMAIL 1";
if (PAYPAL_SANDBOX_EMAIL_1 == "ERROR NO SANDBOX EMAIL 1") {
  throw new Error(
    "PAYAPL_SANDBOX_EMAIL_1 not specified in environment variables"
  );
}
const PAYPAL_SANDBOX_EMAIL_1_PASSWORD: string =
  process.env.PAYPAL_SANDBOX_EMAIL_1_PASSWORD ||
  "ERROR NO SANDBOX EMAIL 1 PASSWORD";
if (PAYPAL_SANDBOX_EMAIL_1_PASSWORD == "ERROR NO SANDBOX EMAIL 1 PASSWORD") {
  throw new Error(
    "PAYAPL_SANDBOX_EMAIL_1_PASSWORD not specified in environment variables"
  );
}
const PAYPAL_SANDBOX_EMAIL_1_GIVEN_NAME: string =
  process.env.PAYPAL_SANDBOX_EMAIL_1_GIVEN_NAME ||
  "ERROR NO SANDBOX EMAIL 1 GIVEN NAME";
if (PAYPAL_SANDBOX_EMAIL_1 == "ERROR NO SANDBOX EMAIL 1 GIVEN NAME") {
  throw new Error(
    "PAYAPL_SANDBOX_EMAIL_1_GIVEN_NAME not specified in environment variables"
  );
}
const PAYPAL_SANDBOX_EMAIL_1_SURNAME: string =
  process.env.PAYPAL_SANDBOX_EMAIL_1_SURNAME ||
  "ERROR NO SANDBOX EMAIL 1 SURNAME";
if (PAYPAL_SANDBOX_EMAIL_1 == "ERROR NO SANDBOX EMAIL 1 SURNAME") {
  throw new Error(
    "PAYAPL_SANDBOX_EMAIL_1_SURNAME not specified in environment variables"
  );
}

const TEST_WHAT =
  process.env.REVERSE_SPEC_TEST_WHAT == "SPEC" ? "SPEC" : "MOCK";

beforeEach(() => {
  if (TEST_WHAT == "SPEC") {
    // Test against the actual paypal service.
    console.log("Testing the Spec");
  } else {
    console.log("Testing the Mock");
    // (FORWARD) test against the mock servise
    paypalMock();
  }
});

test("Fail to authenticate with paypal", async () => {
  const auth = Buffer.from("invalid_user:invalid_password").toString("base64");
  const response = await fetch(`${baseURL.sandbox}/v1/oauth2/token`, {
    method: "POST",
    body: "grant_type=client_credentials",
    headers: {
      Authorization: `Basic ${auth}`,
    },
  });
  const body = await response.json();
  expect(response.status).toBe(401);
  expect(body).toMatchInlineSnapshot(`
    Object {
      "error": "invalid_client",
      "error_description": "Client Authentication failed",
    }
  `);
});

test("Authenticate with paypal successfully", async () => {
  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_APP_SECRET}`).toString(
    "base64"
  );

  const response = await fetch(`${baseURL.sandbox}/v1/oauth2/token`, {
    method: "POST",
    body: "grant_type=client_credentials",
    headers: {
      Authorization: `Basic ${auth}`,
    },
  });
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body).toMatchInlineSnapshot(
    {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      access_token: expect.any(String),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      expires_in: expect.any(Number),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      nonce: expect.any(String),
    },
    `
    Object {
      "access_token": Any<String>,
      "app_id": "APP-80W284485P519543T",
      "expires_in": Any<Number>,
      "nonce": Any<String>,
      "scope": "https://uri.paypal.com/services/checkout/one-click-with-merchant-issued-token https://uri.paypal.com/services/invoicing https://uri.paypal.com/services/vault/payment-tokens/read https://uri.paypal.com/services/disputes/read-buyer https://uri.paypal.com/services/payments/realtimepayment https://uri.paypal.com/services/disputes/update-seller https://uri.paypal.com/services/payments/payment/authcapture openid https://uri.paypal.com/services/disputes/read-seller Braintree:Vault https://uri.paypal.com/services/payments/refund https://api.paypal.com/v1/vault/credit-card https://uri.paypal.com/services/billing-agreements https://api.paypal.com/v1/payments/.* https://uri.paypal.com/payments/payouts https://uri.paypal.com/services/vault/payment-tokens/readwrite https://api.paypal.com/v1/vault/credit-card/.* https://uri.paypal.com/services/shipping/trackers/readwrite https://uri.paypal.com/services/subscriptions https://uri.paypal.com/services/applications/webhooks",
      "token_type": "Bearer",
    }
  `
  );
});

test("Paypal Payout", async () => {
  const accessToken = await generateAccessToken();
  const url = `${baseURL.sandbox}/v1/payments/payouts`;
  const batchId = crypto.randomUUID();
  const amount = "5.00";
  const user_emails = [PAYPAL_SANDBOX_EMAIL_1];
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      sender_batch_header: {
        sender_batch_id: batchId,
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
        sender_item_id: batchId + String(i).padStart(3, "0"),
        recipient_wallet: "PAYPAL",
        receiver: email,
      })),
    }),
  });
  const body = await response.json();

  expect(response.status).toBe(201);
  expect(body).toMatchInlineSnapshot(
    {
      batch_header: {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        payout_batch_id: expect.stringMatching(/[A-Z0-9]{13}/),
        sender_batch_header: {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          sender_batch_id: expect.any(String),
        },
      },
      links: [
        {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          href: expect.stringMatching(
            /https:\/\/api\.sandbox\.paypal\.com\/v1\/payments\/payouts\/[A-Z0-9]{13}/
          ),
        },
      ],
    },
    `
    Object {
      "batch_header": Object {
        "batch_status": "PENDING",
        "payout_batch_id": StringMatching /\\[A-Z0-9\\]\\{13\\}/,
        "sender_batch_header": Object {
          "email_message": "Sorry, we did not reach our funding goal we have returned you money with something extra for supporting us.",
          "email_subject": "DAC Demo Gratitude",
          "recipient_type": "EMAIL",
          "sender_batch_id": Any<String>,
        },
      },
      "links": Array [
        Object {
          "encType": "application/json",
          "href": StringMatching /https:\\\\/\\\\/api\\\\\\.sandbox\\\\\\.paypal\\\\\\.com\\\\/v1\\\\/payments\\\\/payouts\\\\/\\[A-Z0-9\\]\\{13\\}/,
          "method": "GET",
          "rel": "self",
        },
      ],
    }
  `
  );
});

test("Paypal Payout error with malformed email", async () => {
  const accessToken = await generateAccessToken();
  const url = `${baseURL.sandbox}/v1/payments/payouts`;
  const batchId = crypto.randomUUID();
  const amount = "5.00";
  const user_emails = ["<bademail@example.com>"];
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      sender_batch_header: {
        sender_batch_id: batchId,
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
        sender_item_id: batchId + String(i).padStart(3, "0"),
        recipient_wallet: "PAYPAL",
        receiver: email,
      })),
    }),
  });
  const body = await response.json();

  expect(response.status).toBe(400);
  expect(body).toMatchInlineSnapshot(
    {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      debug_id: expect.stringMatching(/[0-9a-f]+/),
    },
    `
    Object {
      "debug_id": StringMatching /\\[0-9a-f\\]\\+/,
      "details": Array [
        Object {
          "field": "items[0].receiver",
          "issue": "Receiver is invalid or does not match with type",
          "location": "body",
        },
      ],
      "information_link": "https://developer.paypal.com/docs/api/payments.payouts-batch/#errors",
      "links": Array [],
      "message": "Invalid request - see details",
      "name": "VALIDATION_ERROR",
    }
  `
  );
});

test("checkout/orders", async () => {
  const accessToken = await generateAccessToken();
  const url = `${baseURL.sandbox}/v2/checkout/orders`;
  const amountUsd = "5.00";
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
  const body = await response.json();

  expect(response.status).toBe(201);
  expect(body).toMatchInlineSnapshot(
    {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      id: expect.stringMatching("[A-Z0-9]+"),
      links: new Array(4).fill({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        href: expect.stringMatching("https://(www|api).sandbox.paypal.com/.*"),
      }),
    },
    `
    Object {
      "id": StringMatching /\\[A-Z0-9\\]\\+/,
      "links": Array [
        Object {
          "href": StringMatching /https:\\\\/\\\\/\\(www\\|api\\)\\.sandbox\\.paypal\\.com\\\\/\\.\\*/,
          "method": "GET",
          "rel": "self",
        },
        Object {
          "href": StringMatching /https:\\\\/\\\\/\\(www\\|api\\)\\.sandbox\\.paypal\\.com\\\\/\\.\\*/,
          "method": "GET",
          "rel": "approve",
        },
        Object {
          "href": StringMatching /https:\\\\/\\\\/\\(www\\|api\\)\\.sandbox\\.paypal\\.com\\\\/\\.\\*/,
          "method": "PATCH",
          "rel": "update",
        },
        Object {
          "href": StringMatching /https:\\\\/\\\\/\\(www\\|api\\)\\.sandbox\\.paypal\\.com\\\\/\\.\\*/,
          "method": "POST",
          "rel": "capture",
        },
      ],
      "status": "CREATED",
    }
  `
  );
});

test("capture payment", async () => {
  const accessToken = await generateAccessToken();
  const amountUsd = "5.00";
  // Create the order on the backend
  const response = await fetch(`${baseURL.sandbox}/v2/checkout/orders`, {
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
  const body: Paypal.CreateOrderResponse = await response.json();
  const orderId = body.id;

  // Approve the order as the user
  if (TEST_WHAT == "SPEC") {
    const approveLink = body.links.filter((link) => link.rel == "approve")[0];
    await (async () => {
      // Doesn't seem to work in headless mode. Fix later.
      const browser = await puppeteer.launch({ headless: false });
      const page = await browser.newPage();
      await page.goto(approveLink.href);
      await page.type("input[type=email]", PAYPAL_SANDBOX_EMAIL_1, {
        delay: 20,
      });
      await page.click("button[type=submit]");
      await page.waitForSelector("input[type=password]", { visible: true });
      await page.type("input[type=password]", PAYPAL_SANDBOX_EMAIL_1_PASSWORD, {
        delay: 20,
      });
      await page.click("#btnLogin");
      await page.waitForSelector("#payment-submit-btn", { visible: true });
      await page.click("#payment-submit-btn");
      await page.waitForNavigation();
      await browser.close();
    })();
  } else {
    // I don't want to mock the whole paypal UI, so let's just make a custom request.

    await fetch(`${baseURL.sandbox}/mock/approve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        orderId: orderId,
        email: PAYPAL_SANDBOX_EMAIL_1,
        givenName: PAYPAL_SANDBOX_EMAIL_1_GIVEN_NAME,
        surname: PAYPAL_SANDBOX_EMAIL_1_SURNAME,
      }),
    });
  }

  // Finally, capture the order.
  const captureUrl = `${baseURL.sandbox}/v2/checkout/orders/${orderId}/capture`;
  const response2 = await fetch(captureUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const body2 = await response2.json<Paypal.CapturePaymentResponse>();

  expect(response2.status).toBe(201);
  // There is quite a big response,
  // I don't really care about most of the info
  // so let's just test what's relevant for us.
  expect(body2.payment_source.paypal.email_address).toBe(
    PAYPAL_SANDBOX_EMAIL_1
  );
  expect(body2.payment_source.paypal.name.given_name).toBe(
    PAYPAL_SANDBOX_EMAIL_1_GIVEN_NAME
  );
  expect(body2.payment_source.paypal.name.surname).toBe(
    PAYPAL_SANDBOX_EMAIL_1_SURNAME
  );
  expect(body2.purchase_units).toHaveLength(1);
  expect(body2.purchase_units[0].payments.captures).toHaveLength(1);
  const capture = body2.purchase_units[0].payments.captures[0];
  expect(capture.amount.currency_code).toBe("USD");
  expect(capture.amount.value).toBe(amountUsd);
  expect(capture.id.length).toBeGreaterThanOrEqual(1);
}, 30000 /* ms. Increase timout it since we open chrome which could
            take a while. */);

test("Refund Paypal payment", async () => {
  const accessToken = await generateAccessToken();
  const amountUsd = "7.00";
  // Create the order on the backend
  const response = await fetch(`${baseURL.sandbox}/v2/checkout/orders`, {
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
  const body: Paypal.CreateOrderResponse = await response.json();
  const orderId = body.id;

  // Approve the order as the user
  if (TEST_WHAT == "SPEC") {
    const approveLink = body.links.filter((link) => link.rel == "approve")[0];
    await (async () => {
      // Doesn't seem to work in headless mode. Fix later.
      const browser = await puppeteer.launch({ headless: false });
      const page = await browser.newPage();
      await page.goto(approveLink.href);
      await page.type("input[type=email]", PAYPAL_SANDBOX_EMAIL_1, {
        delay: 20,
      });
      await page.click("button[type=submit]");
      await page.waitForSelector("input[type=password]", { visible: true });
      await page.type("input[type=password]", PAYPAL_SANDBOX_EMAIL_1_PASSWORD, {
        delay: 20,
      });
      await page.click("#btnLogin");
      await page.waitForSelector("#payment-submit-btn", { visible: true });
      await page.click("#payment-submit-btn");
      await page.waitForNavigation();
      await browser.close();
    })();
  } else {
    // I don't want to mock the whole paypal UI, so let's just make a custom request.

    await fetch(`${baseURL.sandbox}/mock/approve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        orderId: orderId,
        email: PAYPAL_SANDBOX_EMAIL_1,
        givenName: PAYPAL_SANDBOX_EMAIL_1_GIVEN_NAME,
        surname: PAYPAL_SANDBOX_EMAIL_1_SURNAME,
      }),
    });
  }

  // Capture the order.
  const captureUrl = `${baseURL.sandbox}/v2/checkout/orders/${orderId}/capture`;
  const response2 = await fetch(captureUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const body2 = await response2.json<Paypal.CapturePaymentResponse>();
  const captureId = body2.purchase_units[0].payments.captures[0].id;

  // Finally, refund the order
  const refundUrl = `${baseURL.sandbox}/v2/payments/captures/${captureId}/refund`;
  const response3 = await fetch(refundUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });
  expect(response3.status).toBe(201);
  const body3 = await response3.json();
  expect(body3).toMatchInlineSnapshot(
    {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      id: expect.stringMatching("[A-Z0-9]+"),
      links: new Array(2).fill({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        href: expect.stringMatching("https://(www|api).sandbox.paypal.com/.*"),
      }),
    },
    `
    Object {
      "id": StringMatching /\\[A-Z0-9\\]\\+/,
      "links": Array [
        Object {
          "href": StringMatching /https:\\\\/\\\\/\\(www\\|api\\)\\.sandbox\\.paypal\\.com\\\\/\\.\\*/,
          "method": "GET",
          "rel": "self",
        },
        Object {
          "href": StringMatching /https:\\\\/\\\\/\\(www\\|api\\)\\.sandbox\\.paypal\\.com\\\\/\\.\\*/,
          "method": "GET",
          "rel": "up",
        },
      ],
      "status": "COMPLETED",
    }
  `
  );
}, 30000 /* ms. Increase timout it since we open chrome which could
            take a while. */);

type PaypalV1Oauth2Token = {
  access_token: string;
  app_id: string;
  expires_in: number;
  nonce: string;
  scope: string;
  token_type: "Bearer";
};

async function generateAccessToken(): Promise<string> {
  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_APP_SECRET}`).toString(
    "base64"
  );

  const response = await fetch(`${baseURL.sandbox}/v1/oauth2/token`, {
    method: "POST",
    body: "grant_type=client_credentials",
    headers: {
      Authorization: `Basic ${auth}`,
    },
  });
  const body: PaypalV1Oauth2Token = await response.json();
  return body.access_token;
}
