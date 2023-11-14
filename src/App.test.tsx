import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import * as ReactRouterDom from "react-router-dom";
import type {
  CreateOrderData,
  CreateOrderActions,
  OnApproveData,
  OnApproveActions,
} from "@paypal/paypal-js/types/components/buttons";
import {
  FundingProgressBar,
  WORKER_URL,
  FunderTable,
  formatTime,
  FundingTimer,
  routes,
  PublishProject,
} from "./App";
import { rest } from "msw";
import { setupServer } from "msw/node";
import { PayPalButtonsComponentProps } from "@paypal/react-paypal-js";
import * as Schema from "./schema";

let counter = 0;
let pendingAmount: number | null = null;
let bonuses: Record<string, Schema.ProjectBonus> = {};
let project: Schema.Project;
beforeEach(() => {
  counter = 0;
  pendingAmount = null;
  const future = new Date();
  future.setHours(future.getHours() + 24);
  bonuses = {
    order1: { email: "bob@example.com", amount: 3 },
    order2: { email: "sally@place.com", amount: 10 },
  };
  project = {
    fundingGoal: "200",
    fundingDeadline: future.toISOString(),
    refundBonusPercent: 5,
    defaultPaymentAmount: 32,
    formHeading: "Test Form Heading",
    description: "<b>be bold</b>",
    authorName: "Test Person",
    authorImageUrl: "http://localhost/image.jpg",
    authorDescription: "Not a <i>real</i> person.",
    isDraft: false,
  };
});

const server = setupServer(
  rest.get(WORKER_URL + "/projects/test/counter", (_req, res, ctx) => {
    return res(
      ctx.json({
        amount: counter,
        orders: [],
      })
    );
  }),
  rest.post(WORKER_URL + "/projects/test/contract", async (req, res, ctx) => {
    const jsonBody = await req.json<{ amount: number }>();
    pendingAmount = jsonBody.amount;
    return res(
      ctx.json({ id: "random_order_id", links: [], status: "CREATED" })
    );
  }),
  rest.patch(
    WORKER_URL + "/projects/test/contract/:orderId",
    (req, res, ctx) => {
      if (req.params["orderId"] !== "random_order_id") {
        throw new Error("Invalid order id");
      }
      if (pendingAmount == null) {
        throw new Error("Call PATCH before POST");
      }
      counter += pendingAmount;
      return res(ctx.json(null));
    }
  ),
  rest.get(WORKER_URL + "/projects/test/bonuses", (_req, res, ctx) => {
    return res(ctx.json({ bonuses: bonuses }));
  }),
  rest.delete(
    WORKER_URL + "/projects/test/bonuses/:orderId",
    (req, res, ctx) => {
      const orderId = req.params["orderId"] as string;
      delete bonuses[orderId];
      return res(ctx.json(null));
    }
  ),
  rest.get(WORKER_URL + "/projects/test", (_req, res, ctx) => {
    if (project == null) {
      return res(ctx.status(404));
    } else {
      return res(ctx.json({ project: project }));
    }
  }),
  rest.get(WORKER_URL + "/projects/dac2023w35production", (_req, res, ctx) => {
    return res(ctx.status(404));
  }),
  rest.get(
    WORKER_URL + "/projects/dac2023w35production/counter",
    (_req, res, ctx) => {
      return res(
        ctx.json({
          amount: 0,
          orders: [],
        })
      );
    }
  ),
  rest.put(WORKER_URL + "/projects/test", async (req, res, ctx) => {
    project = (await req.json<{ project: Schema.Project }>()).project;
    return res(ctx.status(200));
  }),
  rest.get(WORKER_URL + "/projects", (_req, res, ctx) => {
    const projects: Record<string, Schema.GetProjectsProject> = {};
    if (project.isDraft == false) projects["test"] = project;
    return res(ctx.json({ projects, cursor: null }));
  }),
  rest.get(WORKER_URL + "/acls/grants", (_req, res, ctx) => {
    return res(
      ctx.json({
        grants: {},
      })
    );
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

type MockAppProps = {
  headerParenthesis?: string;
};

function MockApp(props: MockAppProps) {
  return <MockAppAtRoute route="/projects/test" {...props} />;
}

function MockAdminApp() {
  return <MockAppAtRoute route="/projects/test/admin" />;
}

function MockEditApp() {
  return <MockAppAtRoute route="/projects/test/edit" />;
}

function MockProjects() {
  return <MockAppAtRoute route="/projects" />;
}

type MockAppAtRouteProps = { route: string } & MockAppProps;

function MockAppAtRoute({ route, headerParenthesis }: MockAppAtRouteProps) {
  return (
    <ReactRouterDom.RouterProvider
      router={ReactRouterDom.createMemoryRouter(
        routes({
          PaypalButtons: MockPaypalButtons,
          headerParenthesis: headerParenthesis,
        }),
        {
          initialEntries: [route],
        }
      )}
    />
  );
}

test("RedirectToProjects", async () => {
  const router = ReactRouterDom.createMemoryRouter(
    routes({ PaypalButtons: MockPaypalButtons }),
    { initialEntries: ["/"] }
  );
  render(<ReactRouterDom.RouterProvider router={router} />);
  await waitFor(() => {
    expect(router.state.location.pathname).toBe("/projects");
  });
});

test("App in-progress", async () => {
  render(<MockApp />);
  const progressbar = await screen.findByRole("progressbar");
  const paypalButton = await screen.findByText("PayPal");

  await waitFor(() => expect(progressbar).toHaveAttribute("value", "0"));

  fireEvent.click(paypalButton);
  const fundedText = await screen.findByText(/funded! Thank you!/i);
  expect(fundedText).toBeInTheDocument();
  expect(counter).toBe(project.defaultPaymentAmount);
});

test("headerParenthesis", async () => {
  render(<MockApp headerParenthesis="header paren" />);
  expect(
    await screen.findByText("EnsureDone (header paren)")
  ).toBeInTheDocument();
});

test("headerParenthesis empty", async () => {
  render(<MockApp />);
  expect(await screen.findByText("EnsureDone")).toBeInTheDocument();
  expect(screen.queryByText("EnsureDone ()")).not.toBeInTheDocument();
});

test("Payment defaults to project.defaultPaymentAmount", async () => {
  render(<MockApp />);
  const amountInput = await screen.findByLabelText("Amount ($)");
  expect(amountInput).toHaveValue(project.defaultPaymentAmount);
});

test("refundBonus displayed", async () => {
  project.refundBonusPercent = 12;
  project.defaultPaymentAmount = 13;
  render(<MockApp />);
  expect(await screen.findByText(/\$14.56/i));
});

test("Less $5 dollar not accepted", async () => {
  render(<MockApp />);
  const amountInput = await screen.findByLabelText("Amount ($)");
  fireEvent.change(amountInput, { target: { value: 4 } });
  expect(await screen.findByText(/at least \$5/i)).toBeInTheDocument();
  const paypalButton = await screen.findByText("PayPal");
  fireEvent.click(paypalButton);
  await waitFor(() => expect(paypalTransactionValid).toBe(false));
  expect(counter).toBe(0);
});

test("More than $500 dollar not accepted (too high chance of mistake/fraudelent refund)", async () => {
  render(<MockApp />);
  const amountInput = await screen.findByLabelText("Amount ($)");
  fireEvent.change(amountInput, { target: { value: 501 } });
  expect(await screen.findByText(/at most \$500/i)).toBeInTheDocument();
  const paypalButton = await screen.findByText("PayPal");
  fireEvent.click(paypalButton);
  await waitFor(() => expect(paypalTransactionValid).toBe(false));
  expect(counter).toBe(0);
});

test("Non-numeric amount not accepted", async () => {
  render(<MockApp />);
  const amountInput = await screen.findByLabelText("Amount ($)");
  fireEvent.change(amountInput, { target: { value: "not a number" } });
  const paypalButton = await screen.findByText("PayPal");
  fireEvent.click(paypalButton);
  await waitFor(() => expect(paypalTransactionValid).toBe(false));
  expect(counter).toBe(0);
});

test("Custom amount of $32 dollars accepted", async () => {
  render(<MockApp />);
  const progressbar = await screen.findByRole("progressbar");
  const amountInput = await screen.findByLabelText("Amount ($)");

  await waitFor(() => expect(progressbar).toHaveAttribute("value", "0"));

  fireEvent.change(amountInput, { target: { value: 32 } });

  const paypalButton = await screen.findByText("PayPal");
  fireEvent.click(paypalButton);
  await waitFor(() => expect(paypalTransactionValid).toBe(true));
  expect(counter).toBe(32);
});

test("Draft Project does not accept Payment", async () => {
  project.isDraft = true;
  render(<MockApp />);
  const amountInput = await screen.findByLabelText("Amount ($)");
  fireEvent.change(amountInput, { target: { value: 20 } });
  expect((await screen.findAllByText(/draft/i))[0]).toBeInTheDocument();
  const paypalButton = await screen.findByText("PayPal");
  fireEvent.click(paypalButton);
  await waitFor(() => expect(paypalTransactionValid).toBe(false));
  expect(counter).toBe(0);
});

test("Funding deadline passed", async () => {
  project.fundingDeadline = "2023-01-01T01:03:00Z";
  render(<MockApp />);
  expect(await screen.findByText(/Funding closed/i)).toBeInTheDocument();
  expect(screen.queryByText("PayPal")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Amount ($)")).not.toBeInTheDocument();
});

test("Funding deadline shown", async () => {
  project.fundingDeadline = new Date(2023, 0, 1, 18, 1, 0).toISOString();
  render(<MockApp />);
  expect(await screen.findByText(/2023-01-01 18:01/i)).toBeInTheDocument();
});

test("Funding count-down shown", async () => {
  const future = new Date();
  future.setDate(future.getDate() + 1);
  future.setHours(future.getHours() + 2);
  future.setMinutes(future.getMinutes() + 3);
  future.setSeconds(future.getSeconds() + 4);
  project.fundingDeadline = future.toISOString();

  render(<MockApp />);
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
  render(<MockAdminApp />);
  expect(await screen.findByText("bob@example.com")).toBeInTheDocument();
  expect(await screen.findByText("3")).toBeInTheDocument();
  expect(await screen.findByText("sally@place.com")).toBeInTheDocument();
  expect(await screen.findByText("10")).toBeInTheDocument();
});

test("AdminApp delete works", async () => {
  render(<MockAdminApp />);
  expect(await screen.findByText("bob@example.com")).toBeInTheDocument();
  expect(await screen.findByText("3")).toBeInTheDocument();
  const deletes = await screen.findAllByText("Delete");
  fireEvent.click(deletes[1]);
  await waitFor(() => {
    expect(screen.queryByText("bob@example.com")).not.toBeInTheDocument();
    expect(screen.queryByText("3")).not.toBeInTheDocument();
  });
});

test("EditApp Works", async () => {
  render(<MockEditApp />);
  async function changeInput(label: string, value: string | number) {
    const input = await screen.findByLabelText(label);
    fireEvent.change(input, { target: { value: value } });
  }
  await changeInput("Funding Goal", "100");
  await changeInput("Funding Deadline", "2023-01-01T12:33");
  await changeInput("Refund Bonus Percent", 5);
  await changeInput("Default Payment Amount", 19);
  await changeInput("Form Heading", "This is a heading");
  await changeInput("Description", "This is a description");
  await changeInput("Author Name", "John Doe");
  await changeInput("Author Image URL", "/image.jpeg");
  await changeInput("Author Description", "This is author description");

  const form = await screen.findByRole("form");
  fireEvent.submit(form);
  await waitFor(() => {
    if (project == null) {
      expect(project).not.toBe(null);
    } else {
      expect(project.fundingGoal).toBe("100");
      expect(project.fundingDeadline).toBe("2023-01-01T10:33:00.000Z");
      expect(project.refundBonusPercent).toBe(5);
      expect(project.defaultPaymentAmount).toBe(19);
      expect(project.formHeading).toBe("This is a heading");
      expect(project.description).toBe("This is a description");
      expect(project.authorName).toBe("John Doe");
      expect(project.authorImageUrl).toBe("/image.jpeg");
      expect(project.authorDescription).toBe("This is author description");
    }
  });
});

describe("EditApp Validation", () => {
  async function changeInput(label: string, value: string | number) {
    const input = await screen.findByLabelText(label);
    fireEvent.change(input, { target: { value: value } });
  }

  beforeEach(async () => {
    render(<MockEditApp />);
    await changeInput("Funding Goal", "100");
    await changeInput("Funding Deadline", "2023-01-01T12:33");
    await changeInput("Refund Bonus Percent", 5);
    await changeInput("Default Payment Amount", 19);
    await changeInput("Form Heading", "This is a heading");
    await changeInput("Description", "This is a description");
    await changeInput("Author Name", "John Doe");
    await changeInput("Author Image URL", "/image.jpeg");
    await changeInput("Author Description", "This is author description");
  });
  describe("prevents empty", () => {
    async function testPreventsEmpty(label: string) {
      const Name = label
        .split(" ")
        .map((w) => w.toLowerCase())
        .map((w) => w[0].toUpperCase() + w.slice(1))
        .join("");
      const name = Name[0].toLowerCase() + Name.slice(1);
      const dynamicProject = project as Record<
        string,
        string | number | boolean
      >;
      const oldProjectValue = dynamicProject[name];
      await changeInput(label, "");
      expect(
        await screen.findByText(`Please enter a ${label}`)
      ).toBeInTheDocument();
      const form = await screen.findByRole("form");
      fireEvent.submit(form);
      // Wait for form submission to complete
      await new Promise((r) => setTimeout(r, 20));
      expect(dynamicProject[name]).toBe(oldProjectValue);
    }
    it("funding goal", async () => {
      await testPreventsEmpty("Funding Goal");
    });
    it("funding deadline", async () => {
      await testPreventsEmpty("Funding Deadline");
    });
    it("refund bonus percent", async () => {
      await testPreventsEmpty("Refund Bonus Percent");
    });
    it("default payment amount", async () => {
      await testPreventsEmpty("Default Payment Amount");
    });
    it("form heading", async () => {
      await testPreventsEmpty("Form Heading");
    });
    it("description", async () => {
      await testPreventsEmpty("Description");
    });
    it("author name", async () => {
      await testPreventsEmpty("Author Name");
    });
    it("author image url", async () => {
      await testPreventsEmpty("Author Image URL");
    });
    it("author description", async () => {
      await testPreventsEmpty("Author Description");
    });
  });

  it("explains paypal fees", async () => {
    await changeInput("Funding Goal", "30");
    expect(await screen.findByText(/5% to 10%/)).toBeInTheDocument();
    expect(await screen.findByText(/\$27.00/)).toBeInTheDocument();
    expect(await screen.findByText(/\$28.50/)).toBeInTheDocument();
  });

  describe("disables when published", () => {
    beforeEach(() => {
      project.isDraft = false;
    });
    it("funding goal", () => {
      expect(screen.getByLabelText("Funding Goal")).toHaveAttribute("disabled");
    });
    it("funding deadline", () => {
      expect(screen.getByLabelText("Funding Deadline")).toHaveAttribute(
        "disabled"
      );
    });
    it("refund bonus percent", () => {
      expect(screen.getByLabelText("Refund Bonus Percent")).toHaveAttribute(
        "disabled"
      );
    });
  });
});

test("PublishProject is disabled until project loaded", async () => {
  project.isDraft = true;
  render(<PublishProject projectId={"test"} />);
  expect(screen.getByRole("button")).toHaveAttribute("disabled");
  await waitFor(() => {
    expect(screen.getByRole("button")).not.toHaveAttribute("disabled");
  });
});

test("PublishProject is disabled if project is already published", async () => {
  project.isDraft = false;
  render(<PublishProject projectId={"test"} />);
  expect(screen.getByRole("button")).toHaveAttribute("disabled");
  await waitFor(() => {
    expect(screen.getByRole("button")).toHaveAttribute("disabled");
  });
});

test("Projects Works", async () => {
  project.isDraft = false;
  project.formHeading = "Test Project 1 Okay";
  project.fundingGoal = "326";

  render(<MockProjects />);
  expect(await screen.findByText(/Test Project 1 Okay/i)).toBeInTheDocument();
  expect(await screen.findByText(/326/i)).toBeInTheDocument();
});
