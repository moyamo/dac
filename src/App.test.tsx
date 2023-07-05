import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import App, {
  FundingProgressBar,
  WORKER_URL,
  FunderTable,
  formatTime,
  FundingTimer,
  PendingPayoutsTable,
  ManualOrdersTable,
} from "./App";
import { rest } from "msw";
import { setupServer } from "msw/node";
import type { Bonus, ManualOrder } from "./worker";

let counter = 0;
let refunded = false;
let pendingAmount: number | null = null;
let fundingDeadline = "2023-01-01T01:01:01Z";
let bonuses: Record<string, Bonus> = {};
let manualOrders: Record<string, ManualOrder> = {};
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
  manualOrders = {
    order1: {
      platform: "paypal",
      userId: "testemail@example.com",
      name: "John Doe",
      amount: 25,
      time: "2023-01-07T02:02:02.000Z",
    },
    order2: {
      platform: "venmo",
      userId: "+38238298342",
      name: "Joe Smith",
      amount: 32,
      time: "2023-01-08T01:01:01.000Z",
    },
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
  }),
  rest.post(WORKER_URL + "/manualOrders", async (req, res, ctx) => {
    manualOrders["new_order"] = await req.json();
    return res(ctx.status(201));
  }),
  rest.get(WORKER_URL + "/manualOrders", (_req, res, ctx) => {
    return res(ctx.json({ manualOrders }));
  }),
  rest.delete(WORKER_URL + "/manualOrders/:orderId", (req, res, ctx) => {
    const orderId = req.params["orderId"] as string;
    delete manualOrders[orderId];
    return res(ctx.json(null));
  })
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

test("Funding deadline passed", async () => {
  fundingDeadline = "2023-01-01T01:03:00Z";
  render(<App />);
  expect(await screen.findByText(/Funding closed/i)).toBeInTheDocument();
  expect(screen.queryByText("PayPal")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Amount")).not.toBeInTheDocument();
});

test("Funding deadline shown", async () => {
  fundingDeadline = new Date(2023, 0, 1, 18, 1, 0).toISOString();
  render(<App />);
  expect(await screen.findByText(/2023-01-01 18:01/i)).toBeInTheDocument();
});

test("Funding count-down shown", async () => {
  const future = new Date();
  future.setDate(future.getDate() + 1);
  future.setHours(future.getHours() + 2);
  future.setMinutes(future.getMinutes() + 3);
  future.setSeconds(future.getSeconds() + 4);
  fundingDeadline = future.toISOString();

  render(<App />);
  expect(await screen.findByText("01:02:03:04")).toBeInTheDocument();
});

test("FundingProgressBar", async () => {
  const { rerender } = render(
    <FundingProgressBar
      funded={false}
      progress={3 * 19}
      goal={203}
      lastUpdated={null}
    />
  );
  const progressbar = await screen.findByRole("progressbar");
  await waitFor(() => {
    expect(progressbar).toHaveAttribute("value", `${19 * 3}`);
    expect(progressbar).toHaveAttribute("max", "203");
  });

  rerender(
    <FundingProgressBar
      funded={true}
      progress={19 * 4}
      goal={203}
      lastUpdated={null}
    />
  );
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

test("PendingPayoutsTable shows bonuses", async () => {
  render(<PendingPayoutsTable />);
  expect(await screen.findByText("bob@example.com")).toBeInTheDocument();
  expect(await screen.findByText("3")).toBeInTheDocument();
  expect(await screen.findByText("sally@place.com")).toBeInTheDocument();
  expect(await screen.findByText("10")).toBeInTheDocument();
});

test("PendingPayoutsTable delete works", async () => {
  render(<PendingPayoutsTable />);
  expect(await screen.findByText("bob@example.com")).toBeInTheDocument();
  expect(await screen.findByText("3")).toBeInTheDocument();
  const deletes = await screen.findAllByText("Delete");
  fireEvent.click(deletes[1]);
  await waitFor(() => {
    expect(screen.queryByText("bob@example.com")).not.toBeInTheDocument();
    expect(screen.queryByText("3")).not.toBeInTheDocument();
  });
});

test("Add manualOrders works", async () => {
  render(<ManualOrdersTable />);
  const timeInput = await screen.findByLabelText("Time");
  const platformInput = await screen.findByLabelText("Platform");
  const userIdInput = await screen.findByLabelText("User ID");
  const nameInput = await screen.findByLabelText("Name");
  const amountInput = await screen.findByLabelText("Amount ($)");

  fireEvent.change(timeInput, { target: { value: "2023-08-03 02:01" } });
  fireEvent.change(platformInput, { target: { value: "paypal" } });
  fireEvent.change(userIdInput, { target: { value: "test@example.com" } });
  fireEvent.change(nameInput, { target: { value: "Jack Door" } });
  fireEvent.change(amountInput, { target: { value: "50" } });
  fireEvent.submit(await screen.findByRole("form"));

  await waitFor(() => {
    expect(screen.queryByText("2023-08-03 02:01")).toBeInTheDocument();
    expect(screen.queryByText("test@example.com")).toBeInTheDocument();
    expect(screen.queryByText("Jack Door")).toBeInTheDocument();
    expect(screen.queryByText("50")).toBeInTheDocument();
  });
});

test("Show manualOrders", async () => {
  render(<ManualOrdersTable />);
  expect(await screen.findByText("paypal")).toBeInTheDocument();
  expect(await screen.findByText("testemail@example.com")).toBeInTheDocument();
  expect(await screen.findByText("John Doe")).toBeInTheDocument();
  expect(await screen.findByText("25")).toBeInTheDocument();
  expect(await screen.findByText("2023-01-07 04:02")).toBeInTheDocument();

  expect(await screen.findByText("venmo")).toBeInTheDocument();
  expect(await screen.findByText("+38238298342")).toBeInTheDocument();
  expect(await screen.findByText("Joe Smith")).toBeInTheDocument();
  expect(await screen.findByText("32")).toBeInTheDocument();
  expect(await screen.findByText("2023-01-08 03:01")).toBeInTheDocument();
});

test("ManualOrdersTable delete works", async () => {
  render(<ManualOrdersTable />);
  expect(await screen.findByText("testemail@example.com")).toBeInTheDocument();
  const deletes = await screen.findAllByText("Delete");
  fireEvent.click(deletes[1]);
  await waitFor(() => {
    expect(screen.queryByText("testemail@example.com")).not.toBeInTheDocument();
  });
});
