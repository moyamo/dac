import { render, screen, waitFor } from "@testing-library/react";
import type {
  CreateOrderData,
  CreateOrderActions,
  OnApproveData,
  OnApproveActions,
} from "@paypal/paypal-js/types/components/buttons";
import App, {
  FundingProgressBar,
  WORKER_URL,
  createOrder,
  onApprove,
} from "./App";
import { rest } from "msw";
import { setupServer } from "msw/node";

let counter = 0;
let refunded = false;
beforeEach(() => {
  counter = 0;
  refunded = false;
});

const server = setupServer(
  rest.get(WORKER_URL + "/counter", (_req, res, ctx) => {
    return res(ctx.text(`${counter}`));
  }),
  rest.get(WORKER_URL + "/refund", (_req, res, ctx) => {
    return refunded ? res() : res(ctx.status(404));
  }),
  rest.post(WORKER_URL + "/contract", (_req, res, ctx) => {
    return res(ctx.json({ id: "random_order_id" }));
  }),
  rest.patch(WORKER_URL + "/contract/:orderId", (req, res, ctx) => {
    if (req.params["orderId"] !== "random_order_id") {
      throw new Error("Invalid order id");
    }
    counter += 1;
    return res(ctx.json(null));
  })
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

test("App refunded", async () => {
  refunded = true;
  render(<App />);
  const refundText = await screen.findByText(
    /the project did not reach the goal/i
  );
  expect(refundText).toBeInTheDocument();
});

test("App in-progress", async () => {
  render(<App />);
  const progressbar = await screen.findByRole("progressbar");

  expect(progressbar).toHaveAttribute("value", "0");

  const orderdata: CreateOrderData = { paymentSource: "paypal" };
  const orderaction: CreateOrderActions = {
    order: {
      async create(_o) {
        await new Promise((r, _e) => r(null));
        return "";
      },
    },
  };
  const id = await createOrder(orderdata, orderaction);
  let funded = false;
  const approvedata: OnApproveData = {
    orderID: id,
    facilitatorAccessToken: "test_access_token",
  };
  const approveactions: OnApproveActions = {
    redirect(_s) {
      void null;
    },
    restart() {
      void null;
    },
  };
  await onApprove((f) => {
    funded = f;
  })(approvedata, approveactions);
  expect(funded).toBe(true);
  expect(counter).toBe(1);
});

test("FundingProgressBar", async () => {
  counter = 3;
  const { rerender } = render(<FundingProgressBar funded={false} />);
  const progressbar = await screen.findByRole("progressbar");
  expect(progressbar).toHaveAttribute("value", `${19 * 3}`);

  counter = 4;
  rerender(<FundingProgressBar funded={true} />);
  await waitFor(() =>
    expect(progressbar).toHaveAttribute("value", `${19 * 4}`)
  );
});
