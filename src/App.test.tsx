import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type {
  CreateOrderData,
  CreateOrderActions,
  OnApproveData,
  OnApproveActions,
} from "@paypal/paypal-js/types/components/buttons";
import App, {
  FundingProgressBar,
  WORKER_URL,
  FunderTable,
  formatTime,
  FundingTimer,
  AdminApp,
} from "./App";
import { rest } from "msw";
import { setupServer } from "msw/node";
import { PayPalButtonsComponentProps } from "@paypal/react-paypal-js";
import type { Bonus } from "./worker";

let counter = 0;
let refunded = false;
let pendingAmount: number | null = null;
let fundingDeadline = "2023-01-01T01:01:01Z";
let bonuses: Record<string, Bonus> = {};
beforeEach(() => {
  counter = 0;
  refunded = false;
  pendingAmount = null;
  const future = new Date();
  future.setHours(future.getHours() + 24);
  fundingDeadline = future.toISOString();
  bonuses = {
    order1: { email: "bob@example.com", amount: 3 },
    order2: { email: "sally@place.com", amount: 10 },
  };
});

const server = setupServer(
  rest.get(WORKER_URL + "/counter", (_req, res, ctx) => {
    return res(
      ctx.json({
        amount: counter,
        orders: [],
        fundingGoal: 507,
        fundingDeadline: fundingDeadline,
      })
    );
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
  }),
  rest.get(WORKER_URL + "/bonuses", (_req, res, ctx) => {
    return res(ctx.json({ bonuses: bonuses }));
  }),
  rest.delete(WORKER_URL + "/bonuses/:orderId", (req, res, ctx) => {
    const orderId = req.params["orderId"] as string;
    delete bonuses[orderId];
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

  await waitFor(() => expect(progressbar).toHaveAttribute("value", "0"));

  fireEvent.click(paypalButton);
  const fundedText = await screen.findByText(/Thank you/i);
  expect(fundedText).toBeInTheDocument();
  expect(counter).toBe(89);
});

test("Payment defaults to $89", async () => {
  render(<App PaypalButtons={MockPaypalButtons} />);
  const amountInput = await screen.findByLabelText("Amount");
  expect(amountInput).toHaveValue(89);
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

  await waitFor(() => expect(progressbar).toHaveAttribute("value", "0"));

  fireEvent.change(amountInput, { target: { value: 32 } });

  const paypalButton = await screen.findByText("PayPal");
  fireEvent.click(paypalButton);
  await waitFor(() => expect(paypalTransactionValid).toBe(true));
  expect(counter).toBe(32);
});

test("Funding deadline passed", async () => {
  fundingDeadline = "2023-01-01T01:03:00Z";
  render(<App PaypalButtons={MockPaypalButtons} />);
  expect(await screen.findByText(/Funding closed/i)).toBeInTheDocument();
  expect(screen.queryByText("PayPal")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Amount")).not.toBeInTheDocument();
});

test("Funding deadline shown", async () => {
  fundingDeadline = new Date(2023, 0, 1, 18, 1, 0).toISOString();
  render(<App PaypalButtons={MockPaypalButtons} />);
  expect(await screen.findByText(/2023-01-01 18:01/i)).toBeInTheDocument();
});

test("Funding count-down shown", async () => {
  const future = new Date();
  future.setDate(future.getDate() + 1);
  future.setHours(future.getHours() + 2);
  future.setMinutes(future.getMinutes() + 3);
  future.setSeconds(future.getSeconds() + 4);
  fundingDeadline = future.toISOString();

  render(<App PaypalButtons={MockPaypalButtons} />);
  expect(await screen.findByText("01:02:03:04")).toBeInTheDocument();
});

test("FundingProgressBar", async () => {
  const { rerender } = render(
    <FundingProgressBar funded={false} progress={3 * 19} goal={203} />
  );
  const progressbar = await screen.findByRole("progressbar");
  await waitFor(() => {
    expect(progressbar).toHaveAttribute("value", `${19 * 3}`);
    expect(progressbar).toHaveAttribute("max", "203");
  });

  rerender(<FundingProgressBar funded={true} progress={19 * 4} goal={203} />);
  await waitFor(() => {
    expect(progressbar).toHaveAttribute("value", `${19 * 4}`);
    expect(progressbar).toHaveAttribute("max", "203");
  });
});

test("Funding Timer Loading", async () => {
  render(<FundingTimer deadline="" />);
  expect(await screen.findByText(/Loading/i)).toBeInTheDocument();
});

test("Table of Funders", async () => {
  render(
    <FunderTable
      orders={[
        {
          name: "Joe K.",
          amount: 6,
          time: new Date(2023, 0, 3, 23, 24).toISOString(),
        },
        {
          name: "Bob M.",
          amount: 30,
          time: new Date(2023, 0, 5, 8, 32).toISOString(),
        },
      ]}
    />
  );
  expect(await screen.findByText(/2023-01-03 23:24/)).toBeInTheDocument();
  expect(await screen.findByText(/Joe K./)).toBeInTheDocument();
  expect(await screen.findByText(/6/)).toBeInTheDocument();
  expect(await screen.findByText(/2023-01-05 08:32/)).toBeInTheDocument();
  expect(await screen.findByText(/Bob M./)).toBeInTheDocument();
  expect(await screen.findByText(/30/)).toBeInTheDocument();
});

test("formatTime", () => {
  expect(formatTime(new Date(2023, 0, 3, 23, 24).toISOString())).toBe(
    "2023-01-03 23:24"
  );
});

test("AdminApp shows bonuses", async () => {
  render(<AdminApp />);
  expect(await screen.findByText("bob@example.com")).toBeInTheDocument();
  expect(await screen.findByText("3")).toBeInTheDocument();
  expect(await screen.findByText("sally@place.com")).toBeInTheDocument();
  expect(await screen.findByText("10")).toBeInTheDocument();
});

test("AdminApp delete works", async () => {
  render(<AdminApp />);
  expect(await screen.findByText("bob@example.com")).toBeInTheDocument();
  expect(await screen.findByText("3")).toBeInTheDocument();
  const deletes = await screen.findAllByText("Delete");
  fireEvent.click(deletes[1]);
  await waitFor(() => {
    expect(screen.queryByText("bob@example.com")).not.toBeInTheDocument();
    expect(screen.queryByText("3")).not.toBeInTheDocument();
  });
});
