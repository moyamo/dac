/** This is a mock for paypal to be run in jest-miniflare context */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import _declareGlobalThis from "jest-environment-miniflare/globals";

import type { Headers } from "@cloudflare/workers-types/experimental";
import { MockInterceptor } from "@miniflare/shared-test-environment/globals";

import * as Paypal from "./paypalTypes";

const closure = {
  email: "",
  amountUsd: "",
};

export default function () {
  const fetchMock = getMiniflareFetchMock();
  // Don't pass through to internet when route is not mocked.
  fetchMock.disableNetConnect();
  const paypalSandbox = fetchMock.get("https://api-m.sandbox.paypal.com");

  closure.email = "";
  closure.amountUsd = "";

  paypalSandbox
    .intercept({ method: "POST", path: "/v1/oauth2/token" })
    .reply(({ headers, body }) => {
      const expectedBody = "grant_type=client_credentials";
      const client_id = process.env.PAYPAL_CLIENT_ID || "valid_client_id";
      const app_secret = process.env.PAYPAL_APP_SECRET || "valid_app_secret";
      const expectedAuth =
        "Basic " + Buffer.from(`${client_id}:${app_secret}`).toString("base64");
      const auth = getAuthorizationHeader(headers);
      if (body == expectedBody && auth == expectedAuth) {
        return {
          statusCode: 200,
          data: JSON.stringify({
            scope:
              "https://uri.paypal.com/services/checkout/one-click-with-merchant-issued-token https://uri.paypal.com/services/invoicing https://uri.paypal.com/services/vault/payment-tokens/read https://uri.paypal.com/services/disputes/read-buyer https://uri.paypal.com/services/payments/realtimepayment https://uri.paypal.com/services/disputes/update-seller https://uri.paypal.com/services/payments/payment/authcapture openid https://uri.paypal.com/services/disputes/read-seller Braintree:Vault https://uri.paypal.com/services/payments/refund https://api.paypal.com/v1/vault/credit-card https://uri.paypal.com/services/billing-agreements https://api.paypal.com/v1/payments/.* https://uri.paypal.com/payments/payouts https://uri.paypal.com/services/vault/payment-tokens/readwrite https://api.paypal.com/v1/vault/credit-card/.* https://uri.paypal.com/services/shipping/trackers/readwrite https://uri.paypal.com/services/subscriptions https://uri.paypal.com/services/applications/webhooks",
            access_token: "VALIDACCESSTOKEN",
            token_type: "Bearer",
            app_id: "APP-80W284485P519543T",
            expires_in: 32351,
            nonce: "2023-05-13T08:26:08ZSOMEBASE64DATA",
          }),
        };
      }
      return {
        statusCode: 401,
        data: JSON.stringify({
          error: "invalid_client",
          error_description: "Client Authentication failed",
        }),
      };
    })
    .persist();

  paypalSandbox
    .intercept({ method: "POST", path: "/v1/payments/payouts" })
    .reply(
      withAuthorization(({ body }) => {
        const payout_batch_id = "ABC0123457689";
        if (typeof body == "string") {
          const bodyJson = JSON.parse(body) as Paypal.PayoutRequest;
          const {
            sender_batch_id,
            recipient_type,
            email_subject,
            email_message,
          } = bodyJson.sender_batch_header;

          const emails_valid = bodyJson.items.every((v) =>
            // This is not a perfect test, but this is just a mock
            /^[A-Za-z0-9.-]+@[A-Za-z0-9.]+$/.test(v.receiver)
          );
          if (!emails_valid) {
            return {
              statusCode: 400,
              data: JSON.stringify({
                debug_id: "ABC0123456789",
                details: [
                  {
                    field: "items[0].receiver",
                    issue: "Receiver is invalid or does not match with type",
                    location: "body",
                  },
                ],
                information_link:
                  "https://developer.paypal.com/docs/api/payments.payouts-batch/#errors",
                links: [],
                message: "Invalid request - see details",
                name: "VALIDATION_ERROR",
              }),
            };
          } else {
            return {
              statusCode: 201,
              data: JSON.stringify({
                batch_header: {
                  batch_status: "PENDING",
                  payout_batch_id: payout_batch_id,
                  sender_batch_header: {
                    email_message: email_message,
                    email_subject: email_subject,
                    recipient_type: recipient_type,
                    sender_batch_id: sender_batch_id,
                  },
                },
                links: [
                  {
                    encType: "application/json",
                    href:
                      "https://api.sandbox.paypal.com/v1/payments/payouts/" +
                      payout_batch_id,
                    method: "GET",
                    rel: "self",
                  },
                ],
              }),
            };
          }
        } else {
          return { statusCode: 400 }; // Malformed request
        }
      })
    );
  const orderId = "ABC0123456789";
  paypalSandbox
    .intercept({ method: "POST", path: "/v2/checkout/orders" })
    .reply(
      withAuthorization(({ body }) => {
        if (typeof body != "string") {
          return { statusCode: 400 };
        }
        const id = orderId;
        const bodyJson = JSON.parse(body) as {
          purchase_units: Array<{ amount: { value: string } }>;
        };
        closure.amountUsd = bodyJson.purchase_units[0].amount.value;
        console.log("Order AmountUsd", closure.amountUsd);
        return {
          statusCode: 201,
          data: JSON.stringify({
            id: id,
            status: "CREATED",
            links: [
              {
                href: `https://api.sandbox.paypal.com/v2/checkout/orders/${id}`,
                method: "GET",
                rel: "self",
              },
              {
                href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}`,
                method: "GET",
                rel: "approve",
              },
              {
                href: `https://api.sandbox.paypal.com/v2/checkout/orders/${id}`,
                method: "PATCH",
                rel: "update",
              },
              {
                href: `https://api.sandbox.paypal.com/v2/checkout/orders/${id}/capture`,
                method: "POST",
                rel: "capture",
              },
            ],
          }),
        };
      })
    );
  // This is not a real route, this is just used to mock the user using the UI
  // to enter the email and password.
  paypalSandbox
    .intercept({ method: "POST", path: "/mock/approve" })
    .reply(({ body }) => {
      console.log("intercepted");
      if (typeof body == "string") {
        const bodyJson = JSON.parse(body) as { orderId: string; email: string };
        closure.email = bodyJson.email;
        console.log("Email ", closure.email);
        return {
          statusCode: 201,
        };
      } else {
        return { statusCode: 400 };
      }
    });

  paypalSandbox
    .intercept({
      method: "POST",
      path: `/v2/checkout/orders/${orderId}/capture`,
    })
    .reply(
      withAuthorization(() => {
        console.log("Capture Amount USD", closure.amountUsd);
        return {
          statusCode: 201,
          data: JSON.stringify({
            payment_source: { paypal: { email_address: closure.email } },
            purchase_units: [
              {
                payments: {
                  captures: [
                    {
                      amount: {
                        currency_code: "USD",
                        value: closure.amountUsd,
                      },
                    },
                  ],
                },
              },
            ],
          }),
        };
      })
    );
}

/** Get's authorization header from mocked headers */
function getAuthorizationHeader(
  headers: Headers | Record<string, string>
): string | null {
  function isRecord(
    h: Headers | Record<string, string>
  ): h is Record<string, string> {
    return typeof h.get != "function";
  }
  let auth = null;

  // This is what we are supposed to do but it doesn't work?
  if (isRecord(headers)) {
    auth = headers["Authorization"];
  } else {
    auth = headers.get("Authorization");
  }
  // For some reason headers is an array at runtime even though that's not
  // the declared type?
  // Maybe this bug? https://github.com/nodejs/undici/issues/1556
  if (Array.isArray(headers)) {
    for (let i = 0; i < headers.length; i++) {
      if (headers[i] == "Authorization") {
        auth = headers[i + 1] as string;
        break;
      }
    }
  }
  return auth;
}

/** Returns null if user is authorized and returns a 403 Forbidden error
 * otherwise.
 *
 * Use like this:
 *
 * let u;
 * if ((u = isUnauthorized(headers))) {
 *   return u
 * }
 */
function isUnauthorized(
  headers: Headers | Record<string, string>
): { statusCode: number } | null {
  const authHeader = getAuthorizationHeader(headers);
  if (authHeader != "Bearer VALIDACCESSTOKEN") {
    return { statusCode: 403 }; // Forbidden
  }
  return null;
}

type mroc<T extends object = object> =
  MockInterceptor.MockReplyOptionsCallback<T>;

/** Wrap this around the mock reply to automatically return 403 Forbidden if unauthorized */
function withAuthorization<T extends object = object>(
  callback: mroc<T>
): mroc<T> {
  const moc: mroc<T> = (req) => {
    let u;
    if ((u = isUnauthorized(req.headers))) {
      return u;
    } else {
      return callback(req);
    }
  };
  return moc;
}
