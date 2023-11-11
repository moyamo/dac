import { Buffer } from "node:buffer";

import * as jose from "jose";
import * as Itty from "itty-router";

import * as Paypal from "./paypalTypes";
import { getInvalidAmountError, hasFundingDeadlinePassed } from "./common";
import * as Schema from "./schema";

// There doesn't seem to be any compile time check that these env vars will
// correspond at runtime to what is declared here, so making Partial.
export type Env = Partial<{
  PAYPAL_API_URL: string;
  PAYPAL_CLIENT_ID: string;
  PAYPAL_APP_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  FRONTEND_URL: string;
  COUNTER: DurableObjectNamespace;
  ADMIN_PASSWORD: string;
  PROJECTS: KVNamespace;
  ACLS: KVNamespace;
}>;

export function getAdmin<R extends Request>(req: R, env: Env): "admin" | null {
  if (!env.ADMIN_PASSWORD) return null;
  const authorization = req.headers.get("Authorization");
  if (authorization == null) return null;
  const authSplit = authorization.split(" ", 2);
  if (authSplit[0] != "Basic" || authSplit.length == 1) return null;
  const basic = Buffer.from(authSplit[1], "base64").toString("ascii");
  const basicSplit = basic.split(":", 2);
  if (basicSplit.length != 2) return null;
  const [username, password] = basicSplit;
  if (username != "admin" || password != env.ADMIN_PASSWORD) return null;
  return "admin";
}

export async function getGoogle<R extends Request>(
  req: R,
  env: Env
): Promise<string | null> {
  if (typeof env.GOOGLE_CLIENT_ID == "undefined") return null;
  const auth = req.headers.get("Authorization");
  if (auth == null) return null;
  const authSplit = auth.split(" ");
  if (authSplit.length != 2) return null;
  if (authSplit[0] != "Bearer") return null;
  const bearerToken = authSplit[1];
  const googleKeysResponse = await fetch(
    "https://www.googleapis.com/oauth2/v3/certs"
  );
  const googleKeysJson = await googleKeysResponse.json<{
    keys: Array<jose.JWK>;
  }>();
  const getGoogleKeys: jose.JWTVerifyGetKey = async (
    protectedHeader,
    _token
  ) => {
    for (const k of googleKeysJson.keys) {
      if (k.kid == protectedHeader.kid) return await jose.importJWK(k);
    }
    throw Error("No key found");
  };
  const ticket = await jose.jwtVerify(bearerToken, getGoogleKeys, {
    audience: env.GOOGLE_CLIENT_ID,
    issuer: "https://accounts.google.com",
  });
  const email = ticket.payload["email"];
  if (typeof email != "string") return null;
  return email;
}

function requestBasicAuthentication() {
  return Itty.text("", {
    status: 401,
    headers: { "WWW-Authenticate": "Basic" },
  });
}

export function withAdmin<R extends Request>(req: R, env: Env) {
  const admin = getAdmin(req, env);
  if (admin == null) return requestBasicAuthentication();
}

let mockUser: string | null = null;

export function setMockUser(user: string | null) {
  mockUser = user;
}

async function withUser(req: Itty.IRequest, env: Env) {
  const admin = getAdmin(req, env);
  if (admin != null) {
    req.user = admin;
    return;
  }
  const googleUser = await getGoogle(req, env);
  if (googleUser != null) {
    req.user = googleUser;
  }
  if (process.env.NODE_ENV == "test") {
    if (mockUser != null) {
      req.user = mockUser;
    }
  }
}

export type AclKindId = "projects";

export type AclKind = {
  allPermissions: Array<Schema.AclPermission>;
};

const AclKinds: Record<AclKindId, AclKind> = {
  projects: {
    allPermissions: ["edit", "publish"],
  },
};

export function aclResourceToAclKind(
  resource: Schema.AclResource
): AclKind | null {
  if (resource.startsWith("/projects/")) {
    return AclKinds["projects"];
  }
  return null;
}

export async function getAcl(
  env: Env,
  resource: Schema.AclResource
): Promise<Schema.Acl> {
  if (typeof env.ACLS == "undefined") throw Error("ACLS undefined");
  const aclString = await env.ACLS.get(resource);
  if (aclString == null) return { grants: {} };
  const acl = Schema.Acl.parse(JSON.parse(aclString));
  return acl;
}

export async function getAclPermissions(
  env: Env,
  resource: Schema.AclResource,
  user: Schema.AclUser
): Promise<Array<Schema.AclPermission>> {
  if (user == "admin") {
    return aclResourceToAclKind(resource)?.allPermissions ?? [];
  }
  const acl = await getAcl(env, resource);
  const permissions = acl.grants[user] ?? [];
  return permissions;
}

async function getProject(
  env: Env,
  projectId: string
): Promise<Schema.Project | null> {
  if (typeof env.PROJECTS == "undefined") {
    throw Error("KV PROJECTS not bound");
  }
  const projectString = await env.PROJECTS.get(projectId);
  if (projectString == null) return null;
  const project = Schema.Project.parse(JSON.parse(projectString));
  return project;
}

async function setProject(
  env: Env,
  projectId: string,
  project: Schema.Project
) {
  if (typeof env.PROJECTS == "undefined") {
    throw Error("KV PROJECTS not bound");
  }
  return await env.PROJECTS.put(projectId, JSON.stringify(project));
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
        methods: ["GET", "HEAD", "POST", "PUT", "OPTIONS", "PATCH", "DELETE"],
        maxAge: 86400,
        headers: {
          "Access-Control-Allow-Credentials": true,
        },
      });
      router.all("*", preflight);
      corsTransform = corsify;
    }

    router.post("/projects/:projectId/contract", async (req) => {
      const projectId = req.params.projectId;
      const jsonBody = await req.json<{ amount: number }>();
      const amount = Number(jsonBody.amount.toFixed(2));
      const error = getInvalidAmountError(amount);
      if (error != null) {
        return Itty.error(400, { error });
      }
      const project = await getProject(env, projectId);
      if (project == null) return Itty.error(404);
      if (hasFundingDeadlinePassed(project.fundingDeadline)) {
        return Itty.error(400, { error: "Funding deadline passed" });
      }
      const order = await createOrder(amount.toFixed(2), env);
      return order;
    });

    router.patch("/projects/:projectId/contract/:orderID", async (req) => {
      const origin = new URL(req.url).origin;
      const orderID = req.params.orderID;
      const projectId = req.params.projectId;
      const project = await getProject(env, projectId);
      if (project == null) return Itty.error(404);
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
      const srb = capture.seller_receivable_breakdown;
      const paypalFee = Number(srb.paypal_fee.value);
      const refundBonusPercent = project.refundBonusPercent;
      const time = new Date().toISOString();
      const obj = Counter.fromName(env, projectId);
      await obj.fetch(`${origin}/contract/${orderID}`, {
        method: "PUT",
        body: JSON.stringify({
          returnAddress,
          captureId,
          amount,
          paypalFee,
          name,
          refundBonusPercent,
          time,
        }),
      });
      return Itty.json();
    });

    router.get("/projects/:projectId/counter", async (req) => {
      const origin = new URL(req.url).origin;
      const projectId = req.params.projectId;
      const obj = Counter.fromName(env, projectId);
      const resp = await obj.fetch(`${origin}/counter`, { method: "GET" });
      const count = await resp.json<number>();
      return count;
    });

    router.get("/projects/:projectId", withUser, async (req) => {
      const { projectId } = req.params;
      const project = await getProject(env, projectId);
      if (project == null) return Itty.error(404);
      if (project.isDraft) {
        if (typeof req.user != "string") return Itty.error(401);
        const resource = new URL(req.url).pathname;
        const permissions = await getAclPermissions(env, resource, req.user);
        if (!permissions.includes("edit")) return Itty.error(403);
      }

      return { project: project };
    });

    router.put("/projects/:projectId", withUser, async (req) => {
      if (typeof req.user != "string") return Itty.error(401);
      const resource = new URL(req.url).pathname;
      const permissions = await getAclPermissions(env, resource, req.user);
      if (!permissions.includes("edit")) return Itty.error(403);

      const { projectId } = req.params;
      const { project } = Schema.PutProjectBody.parse(await req.json());

      const prevProject = await getProject(env, projectId);
      if ((prevProject?.isDraft ?? true) != project.isDraft) {
        if (!permissions.includes("publish")) return Itty.error(403);
      }

      if (prevProject != null && !prevProject.isDraft) {
        // Can't change these parameters after the project is published
        if (
          prevProject.fundingDeadline != project.fundingDeadline ||
          prevProject.fundingGoal != project.fundingGoal ||
          prevProject.refundBonusPercent != project.refundBonusPercent
        )
          return Itty.error(403);
      }

      await setProject(env, projectId, project);
      return {};
    });

    router.get("/projects/:projectId/successInvoice", withUser, async (req) => {
      if (typeof req.user != "string") return Itty.error(401);
      const { projectId } = req.params;
      const resource = `/projects/${projectId}`;
      const permissions = await getAclPermissions(env, resource, req.user);
      if (!permissions.includes("edit")) return Itty.error(403);

      const url = new URL(req.url);
      const obj = Counter.fromName(env, projectId);
      const response = await obj.fetch(
        `${url.origin}/successInvoice?projectId=${projectId}`
      );
      return response;
    });

    router.post("/projects/:projectId/refund", withAdmin, async (req) => {
      const projectId: string = req.params.projectId;
      const obj = Counter.fromName(env, projectId);
      const url = new URL(request.url);
      const refunds = await obj.fetch(
        `${url.origin}/refunds?projectId=${projectId}`
      );
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

    router.get("/projects/:projectId/bonuses", withAdmin, (req) => {
      const origin = new URL(req.url).origin;
      const projectId = req.params.projectId;
      return Counter.fromName(env, projectId).fetch(
        `${origin}/bonuses?projectId=${projectId}`,
        {
          method: req.method,
        }
      );
    });

    router.delete("/projects/:projectId/bonuses/:orderID", withAdmin, (req) => {
      const origin = new URL(req.url).origin;
      const projectId = req.params.projectId;
      const orderID = req.params.orderID;
      return Counter.fromName(env, projectId).fetch(
        `${origin}/bonuses/${orderID}`,
        {
          method: req.method,
        }
      );
    });

    router.get("/acls/grants", withUser, async (req) => {
      if (typeof req.user != "string") return Itty.error(401);
      const resource = req.query["resource"];
      if (resource == null || Array.isArray(resource)) return Itty.error(400);
      const permissions = await getAclPermissions(env, resource, req.user);
      // To view the list you must have some permission for the object.
      if (permissions.length == 0) return Itty.error(403);
      const acl = await getAcl(env, resource);

      return Itty.json({
        grants: acl.grants,
      });
    });

    router.post("/acls/grants", withUser, async (req) => {
      const jsonBody = Schema.PostAclsGrantBody.parse(await req.json());
      const { grant } = jsonBody;
      if (typeof req.user != "string") return Itty.error(401);
      const ourPermissions = await getAclPermissions(
        env,
        grant.resource,
        req.user
      );

      const allPermissions =
        aclResourceToAclKind(grant.resource)?.allPermissions ?? [];

      for (const requestedPermission of grant.permissions) {
        // We can only grant permissions that exist!
        if (!allPermissions.includes(requestedPermission))
          return Itty.error(400);
        // We can only grant permissions we have!
        if (!ourPermissions.includes(requestedPermission))
          return Itty.error(403);
      }
      if (typeof env.ACLS == "undefined") throw Error("ACLS undefined");

      const currentPermissions = await getAclPermissions(
        env,
        grant.resource,
        grant.user
      );
      let changed = false;
      for (const requestedPermission of grant.permissions) {
        if (!currentPermissions.includes(requestedPermission)) {
          currentPermissions.push(requestedPermission);
          changed = true;
        }
      }
      const acl = await getAcl(env, grant.resource);
      // TODO there is a race here with other requests that should be fixed by
      // synchronizing writes through durable objects.
      if (changed) {
        acl.grants[grant.user] = currentPermissions;
        await env.ACLS.put(grant.resource, JSON.stringify(acl));
      }
      return Itty.json({
        grants: acl.grants,
      });
    });

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
  paypalFee: number;
  name: string;
  refundBonusPercent: number;
  time: string;
};

// Durable Object

export class Counter implements DurableObject {
  state: DurableObjectState;
  env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;

    void this.state.blockConcurrencyWhile(async () => {
      const version = (await this.state.storage.get("version")) ?? 0;
      if (version == 0) {
        console.info(
          `Upgrading Durable Object Counter from v0 to v1: ${
            this.state.id.name ?? "null"
          } (${this.state.id.toString()})`
        );
        type InternalOrderV0 = {
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
        type OrderMapV0 = { [orderId: string]: InternalOrderV0 };
        const orderMap: OrderMapV0 =
          (await this.state.storage.get("orderMap")) || {};
        type InternalOrderV1 = InternalOrderV0 & { paypalFee: number };
        type OrderMapV1 = { [orderId: string]: InternalOrderV1 };
        const newOrderMap: OrderMapV1 = Object.fromEntries<InternalOrderV1>(
          await Promise.all(
            Object.entries(orderMap).map<Promise<[string, InternalOrderV1]>>(
              ([orderId, order]) =>
                (async () => {
                  console.info(`Fetching fee for capture ${order.captureId}`);
                  const capture = await getCapture(order.captureId, this.env);
                  return [
                    orderId,
                    {
                      ...order,
                      paypalFee: Number(
                        capture.seller_receivable_breakdown.paypal_fee.value
                      ),
                    },
                  ];
                })()
            )
          )
        );
        await this.state.storage.put("orderMap", newOrderMap);
        await this.state.storage.put("version", 1);
      }
    });
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
      paypalFee: number;
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
        paypalFee: body.paypalFee,
        bonus: {
          refunded: false,
          amount: Number(
            ((body.amount * body.refundBonusPercent) / 100.0).toFixed(2)
          ),
        },
        name: body.name,
        time: body.time,
      };
      await this.state.storage.put("orderMap", orderMap);
      return "";
    });

    router.get("/successInvoice", async (req) => {
      if (req.query.projectId == null) return Itty.error(400);
      if (Array.isArray(req.query.projectId)) return Itty.error(400);
      const project = await getProject(this.env, req.query.projectId);
      if (project == null) return Itty.error(404);
      if (!hasFundingDeadlinePassed(project.fundingDeadline)) {
        return Itty.error(404);
      }
      const orderMap: OrderMap =
        (await this.state.storage.get("orderMap")) || {};

      const totalAmount = Object.values(orderMap).reduce(
        (total, o) => total + o.amount,
        0
      );
      if (totalAmount < Number(project.fundingGoal)) return Itty.error(404);

      const successInvoice = Object.values(orderMap).map((o) => ({
        time: o.time,
        name: o.name,
        amount: o.amount,
        paypalFee: o.paypalFee,
      }));
      const response = { successInvoice, authorName: project.authorName };
      return response;
    });

    router.get("/refunds", async (req) => {
      if (req.query.projectId == null) return Itty.error(400);
      if (Array.isArray(req.query.projectId)) return Itty.error(400);
      const project = await getProject(this.env, req.query.projectId);
      if (project == null) return Itty.error(404);
      if (!hasFundingDeadlinePassed(project.fundingDeadline)) {
        return Itty.error(404);
      }
      const orderMap: OrderMap =
        (await this.state.storage.get("orderMap")) || {};

      const totalAmount = Object.values(orderMap).reduce(
        (total, o) => total + o.amount,
        0
      );
      if (totalAmount >= Number(project.fundingGoal)) return Itty.error(404);

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

    router.get("/bonuses", async (req) => {
      if (req.query.projectId == null) return Itty.error(400);
      if (Array.isArray(req.query.projectId)) return Itty.error(400);
      const project = await getProject(this.env, req.query.projectId);
      if (project == null) return Itty.error(404);
      if (!hasFundingDeadlinePassed(project.fundingDeadline)) {
        return Itty.error(404);
      }
      const orderMap: OrderMap =
        (await this.state.storage.get("orderMap")) || {};

      const totalAmount = Object.values(orderMap).reduce(
        (total, o) => total + o.amount,
        0
      );
      if (totalAmount >= Number(project.fundingGoal)) return Itty.error(404);

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
      const response = { bonuses };
      return response;
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

// For a fully working example, please see:
// https://github.com/paypal-examples/docs-examples/tree/main/standard-integration

/// ///////////////////
// PayPal API helpers
/// ///////////////////

// use the orders api to create an order
export async function createOrder(
  amountUsd: string,
  env: Env
): Promise<Paypal.CreateOrderResponse> {
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
  const data = Paypal.CreateOrderResponse.parse(await response.json());
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
  const data = Paypal.CapturePaymentResponse.parse(await response.json());
  return data;
}

export async function getCapture(
  captureId: string,
  env: Env
): Promise<Paypal.GetCaptureResponse> {
  if (typeof env.PAYPAL_API_URL == "undefined")
    throw new TypeError("PAYPAL_API_URL is undefined");
  const accessToken = await generateAccessToken(env);
  const url = `${env.PAYPAL_API_URL}/v2/payments/captures/${captureId}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const data = Paypal.GetCaptureResponse.parse(await response.json());
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
  const data = Paypal.RefundCaptureResponse.parse(await response.json());
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
