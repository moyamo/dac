import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type {
  CreateOrderData,
  CreateOrderActions,
  OnApproveData,
  OnApproveActions,
} from "@paypal/paypal-js/types/components/buttons";
import App, { FundingProgressBar, WORKER_URL } from "./App";
import { rest } from "msw";
import { setupServer } from "msw/node";
import { PayPalButtonsComponentProps } from "@paypal/react-paypal-js";

let counter = 0;
let refunded = false;
let pendingAmount: number | null = null;
beforeEach(() => {
  counter = 0;
  refunded = false;
  pendingAmount = null;
});

const server = setupServer(
  rest.get(WORKER_URL + "/counter", (_req, res, ctx) => {
    return res(ctx.json({ amount: counter }));
  }),
  rest.get(WORKER_URL + "/refund", (_req, res, ctx) => {
    return refunded ? res() : res(ctx.status(404));
  }),
  rest.post(WORKER_URL + "/contract", async (req, res, ctx) => {
    const jsonBody = await req.json<{ amount: number }>();
    pendingAmount = jsonBody.amount;
    return res(ctx.json({ id: "random_order_id" }));
  }),
  rest.patch(WORKER_URL + "/contract/:orderId", (req, res, ctx) => {
    if (req.params["orderId"] !== "random_order_id") {
      throw new Error("Invalid order id");
    }
    if (pendingAmount == null) {
      throw new Error("Call PATCH before POST");
    }
    counter += pendingAmount;
    return res(ctx.json(null));
  })
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

let paypalTransactionValid: boolean | null = null;

function MockPaypalButtons(props: PayPalButtonsComponentProps) {
  const { onClick, createOrder, onApprove } = props;
  const onClickOrDefault = onClick || ((_data, actions) => actions.resolve());
  return (
    <button
      onClick={(e) => {
        paypalTransactionValid = null;
        e.preventDefault();
        void onClickOrDefault(
          {},
          {
            async reject() {
              await new Promise((resolve, _reject) => resolve(null));
              paypalTransactionValid = false;
            },
            async resolve() {
              if (!createOrder) {
                paypalTransactionValid = true;
                return;
              }
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
              if (!onApprove) {
                paypalTransactionValid = true;
                return;
              }
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
              await onApprove(approvedata, approveactions);
              paypalTransactionValid = true;
            },
          }
        );
      }}
    >
      PayPal
    </button>
  );
}

test("App refunded", async () => {
  refunded = true;
  render(<App PaypalButtons={MockPaypalButtons} />);
  const refundText = await screen.findByText(
    /the project did not reach the goal/i
  );
  expect(refundText).toBeInTheDocument();
});

test("App in-progress", async () => {
  render(<App PaypalButtons={MockPaypalButtons} />);
  const progressbar = await screen.findByRole("progressbar");
  const paypalButton = await screen.findByText("PayPal");

  expect(progressbar).toHaveAttribute("value", "0");

  fireEvent.click(paypalButton);
  const fundedText = await screen.findByText(/Thank you/i);
  expect(fundedText).toBeInTheDocument();
  expect(counter).toBe(19);
});

test("Payment defaults to $19", async () => {
  render(<App PaypalButtons={MockPaypalButtons} />);
  const amountInput = await screen.findByLabelText("Amount");
  expect(amountInput).toHaveValue(19);
});

test("Less $5 dollar not accepted", async () => {
  render(<App PaypalButtons={MockPaypalButtons} />);
  const amountInput = await screen.findByLabelText("Amount");
  fireEvent.change(amountInput, { target: { value: 4 } });
  expect(await screen.findByText(/at least \$5/i)).toBeInTheDocument();
  const paypalButton = await screen.findByText("PayPal");
  fireEvent.click(paypalButton);
  await waitFor(() => expect(paypalTransactionValid).toBe(false));
  expect(counter).toBe(0);
});

test("More than $500 dollar not accepted (too high chance of mistake/fraudelent refund)", async () => {
  render(<App PaypalButtons={MockPaypalButtons} />);
  const amountInput = await screen.findByLabelText("Amount");
  fireEvent.change(amountInput, { target: { value: 501 } });
  expect(await screen.findByText(/at most \$500/i)).toBeInTheDocument();
  const paypalButton = await screen.findByText("PayPal");
  fireEvent.click(paypalButton);
  await waitFor(() => expect(paypalTransactionValid).toBe(false));
  expect(counter).toBe(0);
});

test("Non-numeric amount not accepted", async () => {
  render(<App PaypalButtons={MockPaypalButtons} />);
  const amountInput = await screen.findByLabelText("Amount");
  fireEvent.change(amountInput, { target: { value: "not a number" } });
  const paypalButton = await screen.findByText("PayPal");
  fireEvent.click(paypalButton);
  await waitFor(() => expect(paypalTransactionValid).toBe(false));
  expect(counter).toBe(0);
});

test("Custom amount of $32 dollars accepted", async () => {
  render(<App PaypalButtons={MockPaypalButtons} />);
  const progressbar = await screen.findByRole("progressbar");
  const amountInput = await screen.findByLabelText("Amount");

  expect(progressbar).toHaveAttribute("value", "0");

  fireEvent.change(amountInput, { target: { value: 32 } });

  const paypalButton = await screen.findByText("PayPal");
  fireEvent.click(paypalButton);
  await waitFor(() => expect(paypalTransactionValid).toBe(true));
  expect(counter).toBe(32);
});

test("FundingProgressBar", async () => {
  counter = 3 * 19;
  const { rerender } = render(<FundingProgressBar funded={false} />);
  const progressbar = await screen.findByRole("progressbar");
  expect(progressbar).toHaveAttribute("value", `${19 * 3}`);

  counter = 4 * 19;
  rerender(<FundingProgressBar funded={true} />);
  await waitFor(() =>
    expect(progressbar).toHaveAttribute("value", `${19 * 4}`)
  );
});
