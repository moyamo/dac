import { FUNDING, PayPalButtonsComponentProps } from "@paypal/react-paypal-js";
import type {
  CreateOrderData,
  CreateOrderActions,
  OnApproveData,
  OnApproveActions,
  OnClickActions,
} from "@paypal/paypal-js/types/components/buttons";
import React from "react";
import * as ReactRouterDom from "react-router-dom";
import type { LoaderFunctionArgs } from "react-router";
import Countdown from "react-countdown";
import "./App.css";
import type {
  Bonus,
  BonusesResponse,
  CounterResponse,
  CreateOrderResponse,
  Order,
  Project,
} from "./worker";
import { getInvalidAmountError, hasFundingDeadlinePassed } from "./common";

export const WORKER_URL =
  process.env.REACT_APP_WORKER_URL || "http://localhost:8787";

/** The Paypal Button doesn't seem to update it's props based on state
 * changes. Using a Ref works. */
function useStateRef<T>(
  defaultValue: T
): [React.MutableRefObject<T>, (newValue: T) => void] {
  const [state, setStateInternal] = React.useState(defaultValue);
  const stateRef = React.useRef(state);
  function setState(newValue: T) {
    stateRef.current = newValue;
    setStateInternal(newValue);
  }
  return [stateRef, setState];
}

function RedirectToDemo() {
  const navigate = ReactRouterDom.useNavigate();
  const toUrl = "/projects/dac2023w35production";

  React.useEffect(() => navigate(toUrl, { replace: true }));
  return (
    <>
      You will be redirected shortly to{" "}
      <ReactRouterDom.Link to={toUrl}>{toUrl}</ReactRouterDom.Link>
    </>
  );
}

export type RoutesArgs = {
  PaypalButtons: React.FunctionComponent<PayPalButtonsComponentProps>;
  headerParenthesis?: string;
};

export function routes({
  PaypalButtons,
  headerParenthesis,
}: RoutesArgs): ReactRouterDom.RouteObject[] {
  return [
    {
      path: "/",
      element: <RedirectToDemo />,
    },
    {
      path: "/projects/:project",
      element: (
        <App
          PaypalButtons={PaypalButtons}
          headerParenthesis={headerParenthesis}
        />
      ),
    },
    {
      path: "/projects/:project/admin",
      loader: projectLoader,
      element: <AdminApp />,
    },
  ];
}

type ProjectLoader = { project?: Project; error?: string };

async function projectLoader({
  request: _reqeust,
  params,
}: LoaderFunctionArgs): Promise<ProjectLoader> {
  const { project: projectId } = params;
  if (typeof projectId == "undefined") {
    return { error: "project undefined" };
  }
  const response = await fetch(`${WORKER_URL}/projects/${projectId}`);
  if (response.ok) {
    const r = await response.json<{ project: Project }>();
    return {
      project: r.project,
    };
  } else {
    return {
      error: `${response.status} ${response.statusText}`,
    };
  }
}

export type AppProps = {
  PaypalButtons: React.FunctionComponent<PayPalButtonsComponentProps>;
  headerParenthesis?: string;
};

function App(props: AppProps) {
  const { PaypalButtons, headerParenthesis } = props;
  const { project } = ReactRouterDom.useParams();
  if (typeof project === "undefined") throw Error("Project undefined");
  const [funded, setFunded] = React.useState(false);
  const [amountRef, setAmount] = useStateRef(89);
  const [progress, setProgress] = React.useState(-1);
  const [fundingGoal, setFundingGoal] = React.useState(-1);
  const [fundingDeadline, setFundingDeadline] = React.useState("");

  const [orders, setOrders] = React.useState<Order[]>([]);

  React.useEffect(() => {
    void (async () => {
      const count = await fetch(`${WORKER_URL}/projects/${project}/counter`);
      const response = await count.json<CounterResponse>();
      setProgress(response.amount);
      setOrders(response.orders);
      setFundingGoal(response.fundingGoal);
      setFundingDeadline(response.fundingDeadline);
    })();
  }, [funded]);

  return (
    <>
      <header>
        <h1>{`Refund Bonus${
          headerParenthesis ? ` (${headerParenthesis})` : ""
        }`}</h1>
      </header>

      {
        <>
          <form>
            <h2>
              Yaseen is creating a platform for raising money for giving away
              products for free
            </h2>
            <FundingProgressBar
              funded={funded}
              progress={progress}
              goal={fundingGoal}
            />
            {hasFundingDeadlinePassed(fundingDeadline) ? null : (
              <>
                <label htmlFor="amount">Amount ($)</label>
                <input
                  type="number"
                  id="amount"
                  name="amount"
                  min="5"
                  max="500"
                  value={amountRef.current}
                  step="1"
                  onChange={(e) => setAmount(Number(e.target.value))}
                />
                <PaypalButtons
                  style={{
                    label: "pay",
                    layout: "horizontal",
                  }}
                  fundingSource={
                    /* Don't allow weird sources, because I may Paypal the money back */
                    FUNDING.PAYPAL
                  }
                  onClick={(_data: unknown, actions: OnClickActions) => {
                    const amount = amountRef.current;
                    if (getInvalidAmountError(amount) == null) {
                      return actions.resolve();
                    } else {
                      return actions.reject();
                    }
                  }}
                  createOrder={async (
                    _data: CreateOrderData,
                    _actions: CreateOrderActions
                  ) => {
                    const response = await fetch(
                      `${WORKER_URL}/projects/${project}/contract`,
                      {
                        method: "POST",
                        body: JSON.stringify({ amount: amountRef.current }),
                      }
                    );
                    const responseJson: CreateOrderResponse =
                      await response.json();
                    return responseJson.id;
                  }}
                  onApprove={async (
                    data: OnApproveData,
                    _actions: OnApproveActions
                  ) => {
                    const response = await fetch(
                      `${WORKER_URL}/projects/${project}/contract/${data.orderID}`,
                      {
                        method: "PATCH",
                      }
                    );
                    if (response.ok) {
                      setFunded(true);
                    } else {
                      alert(`Error ${response.status} ${response.statusText}`);
                    }
                  }}
                />
                <p>
                  {getInvalidAmountError(amountRef.current) || (
                    <>
                      {`Thanks for pledging $${amountRef.current}! If we do not reach our goal you will get a`}{" "}
                      <strong>
                        {`$${(amountRef.current * 1.2).toFixed(2)}`}
                      </strong>
                      {` refund!`}
                    </>
                  )}
                </p>
              </>
            )}
            <FundingTimer deadline={fundingDeadline} />
          </form>
          <h2>How to give things away for free and get paid doing it </h2>
          <p>
            <i>
              Imagine a world with no ads or paywalls. A world where
              Game-of-Thrones-quality shows are freely available on YouTube. A
              world where open-source software gets the same level of funding as
              proprietary software. A world where people can freely reuse ideas
              and music without paying royalties. Is this a fantasy world? No,
              this is the world where people use this platform.
            </i>
          </p>
          <p>Here is how this works. You give me money.</p>
          <ul>
            <li>
              {" "}
              If I do not reach the target by the deadline. I will refund
              everyone. I will also{" "}
              <em>give a refund bonus of 20% your pledge</em> as a thank you for
              supporting this project{" "}
            </li>
            <li>
              If I do reach that target by the deadline. I keep all the money
              and use it to develop a platform that allows you to raise money in
              the same way (crowdfunding with a refund bonus) to fund your art
              projects, software projects, etc. &mdash; anything you are willing
              to give a way for free.
            </li>
          </ul>
          <b>It&apos;s a win-win situation. Why haven&apos;t you pledged?</b>
          <h3>Details</h3>
          <p>
            You&apos;re collectively paying for 1 month of my time to make this
            idea a reality. I&apos;ll likely ask for additional funding in the
            future to implement more features after the first month, and for
            specific expenses as they come up.
          </p>
          <p>
            The plan is to create a website where public-good producers can
            create a page that
          </p>
          <ul>
            <li>will have a description of the project,</li>
            <li>
              will have a progress bar showing how much and who have pledged,
              and
            </li>
            <li>will handle payments with PayPal.</li>
            <li>
              If the project doesn&apos;t reach its funding goal, then the
              customers will be automatically refunded (with a refund bonus). If
              the project does reach its goal, then the public-good producer
              will receive the funding in their PayPal account.
            </li>
            <li>
              The public-good producer will put up the refund bonus as
              collateral using PayPal.
            </li>
          </ul>
          <p>
            The website is essentially already done. (You are looking at the
            prototype now!). It just needs to be fleshed out to allow other
            public-good producers to upload their projects. Really, what I
            actually want to do is find people who want to create public goods
            and get feedback from them (if that&apos;s you please{" "}
            <a href="#contact"> join our discord or contact me</a>). I may try
            some additional cool things, such as
          </p>
          <ul>
            <li>using prediction markets to price projects, or</li>
            <li>
              bringing in investors/advertisers who will put up the collateral
              on behalf of the producers and who will take a cut if the project
              succeeds.
            </li>
          </ul>
          <h3>
            &ldquo;I don&apos;t believe you. How will giving you money make
            Game-of-Thrones quality shows on freely available on YouTube?&rdquo;
          </h3>
          <p>
            If you have an idea for a great show, instead of pitching it to
            holywood executives, you could pitch it to the public and have them
            crowdfund it. Then after you produce it, you give it away for free.{" "}
          </p>
          <h3>
            &ldquo;I have questions,&rdquo; or &ldquo;I don&apos;t trust
            you.&rdquo;
          </h3>
          <p>
            You can check out my social media below. The list of funders and the
            time they funded is also listed below so can check that I&apos;m not
            cheating.
          </p>
          <div id="contact">
            <h2> Yaseen Mowzer </h2>
            <img
              id="portrait"
              src="/yaseen-portrait.jpg"
              width="128"
              height="128"
            ></img>
            <div id="contact-content">
              <p>
                Yaseen is a Software Developer with over 3 years of industry
                experience. You can{" "}
              </p>
              <ul>
                <li>
                  follow me for updates{" "}
                  <a href="https://twitter.com/Moyamodehacker">
                    @moyamodehacker
                  </a>
                </li>
                <li>
                  join us on the{" "}
                  <a href="https://discord.gg/KGeCTx33g">
                    Refund Bonus Discord
                  </a>
                </li>
                <li>
                  email me at{" "}
                  <a href="mailto:yaseen@mowzer.co.za">yaseen@mowzer.co.za</a>
                </li>

                <li>
                  verify that I&apos;m a real person on{" "}
                  <a href="https://www.linkedin.com/in/yaseen-mowzer-389938165/">
                    Linked in
                  </a>
                </li>
                <li>
                  fork this website on{" "}
                  <a href="https://github.com/moyamo/dac">
                    github.com/moyamo/dac
                  </a>
                </li>
              </ul>
            </div>
          </div>
          <hr />
          <h2>Funders</h2>
          <FunderTable orders={orders} />
        </>
      }
    </>
  );
}

export type FundingProgressBarProps = {
  funded: boolean;
  progress: number;
  goal: number;
};

export function FundingProgressBar(props: FundingProgressBarProps) {
  const { funded, progress, goal } = props;
  return progress == -1 ? (
    <span>Loading...</span>
  ) : (
    <div className="funding-progress-bar">
      <div>
        <progress
          style={{ width: "100%", height: "1em" }}
          role="progressbar"
          value={progress}
          max={goal}
        />
      </div>
      <big>
        {`$${progress} / $${goal} funded!`}
        {funded ? " Thank you!" : null}{" "}
      </big>
    </div>
  );
}

export type FundingTimerProps = {
  deadline: string;
};

export function FundingTimer(props: FundingTimerProps) {
  const { deadline } = props;
  if (deadline == "") {
    return <span>Loading deadline...</span>;
  } else if (hasFundingDeadlinePassed(deadline)) {
    return (
      <span>
        Funding closed on {formatTime(deadline)}. No more funds are being
        accepted.
      </span>
    );
  } else {
    // Something is going weird with the modules in this pacakge which causes
    // the Coundown function to be on the default property instead of being
    // Countdown itself
    const CountdownDefault =
      "default" in Countdown
        ? (Countdown.default as React.FunctionComponent)
        : Countdown;
    return (
      <>
        <p>
          Funding closing at <b>{formatTime(deadline)}</b>.
        </p>
        <div className="funding-countdown">
          <CountdownDefault date={new Date(deadline)} />
        </div>
      </>
    );
  }
}

export type FunderTableProps = {
  orders: Order[];
};

export function FunderTable(props: FunderTableProps) {
  const { orders } = props;
  return (
    <table>
      <thead>
        <tr>
          <th> Time ({getLocalTimezoneShortName()}) </th>
          <th> Name </th>
          <th> Amount ($) </th>
        </tr>
      </thead>
      <tbody>
        {orders.map((order) => (
          <tr key={order.time}>
            <td> {formatTime(order.time)} </td>
            <td> {order.name} </td>
            <td> {order.amount} </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function getLocalTimezoneShortName() {
  return new Date()
    .toLocaleDateString(undefined, { day: "2-digit", timeZoneName: "short" })
    .substring(4);
}

/** Returns local time in format "0000-00-00 00:00" */
export function formatTime(isoTimeString: string): string {
  // Does javascript not support %Y-%m-%d %H:%M format string?
  const time = new Date(isoTimeString);
  const pad = (v: number) => (String(v).length == 1 ? "0" : "") + String(v);
  return (
    `${time.getFullYear()}-${pad(time.getMonth() + 1)}` +
    `-${pad(time.getDate())} ` +
    `${pad(time.getHours())}:${pad(time.getMinutes())}`
  );
  // return time.toISOString().replace("T", " ").slice(0, "0000-00-00 00:00".length);
}

export function AdminApp() {
  const { project } = ReactRouterDom.useParams();
  if (typeof project === "undefined") throw Error("Project undefined");
  return (
    <>
      <h1>Admin App</h1>
      <h2>Pending Payouts</h2>
      <PendingPayoutsTable project={project} />
      <h2>Config</h2>
      <ConfigForm project={project} />
    </>
  );
}

type PendingPayoutsTableProps = {
  project: string;
};

function PendingPayoutsTable(props: PendingPayoutsTableProps) {
  const { project } = props;
  const [bonuses, setBonuses] = React.useState<Record<string, Bonus>>({});
  const [updates, setUpdates] = React.useState(0);
  React.useEffect(() => {
    void (async () => {
      const response = await fetch(
        `${WORKER_URL}/projects/${project}/bonuses`,
        {
          credentials: "include",
        }
      );
      const bonuses = await response.json<BonusesResponse>();
      setBonuses(bonuses.bonuses || {});
    })();
  }, [updates]);

  return (
    <table>
      <thead>
        <tr>
          <th> Email ({getLocalTimezoneShortName()}) </th>
          <th> Amount ($) </th>
          <th> Delete </th>
        </tr>
      </thead>
      <tbody>
        {Object.entries(bonuses).map(([orderId, bonus]) => (
          <tr key={orderId}>
            <td> {bonus.email} </td>
            <td> {bonus.amount} </td>
            <td>
              <button
                onClick={() =>
                  void (async () => {
                    const r = await fetch(
                      `${WORKER_URL}/projects/${project}/bonuses/${orderId}`,
                      {
                        method: "DELETE",
                        credentials: "include",
                      }
                    );
                    if (!r.ok) {
                      alert(`${r.status} ${r.statusText}`);
                    }
                    setUpdates((updates) => updates + 1);
                  })()
                }
              >
                Delete
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const ProjectStateContext = React.createContext<
  [Partial<Project>, React.Dispatch<React.SetStateAction<Partial<Project>>>]
>([{}, (_mP) => null]);

function ProjectInput({ type, label }: { type: string; label: string }) {
  const [project, setProject] = React.useContext(ProjectStateContext);
  function onFirstChar(f: (s: string) => string) {
    // Returns function which applies f to first character of the first argument
    return (s: string) => f(s.slice(0, 1)) + s.slice(1);
  }
  const Name = label
    .split(" ")
    .map(onFirstChar((c) => c.toUpperCase()))
    .join("");
  const name = onFirstChar((c) => c.toLowerCase())(Name) as keyof Project;
  const id = "ConfigForm" + Name;

  function projectToInput(project: Partial<Project>): string {
    let value = project[name] || "";
    if (type == "datetime-local" && value != "") {
      // See https://stackoverflow.com/questions/30166338/setting-value-of-datetime-local-from-date
      const valueD = new Date(value);
      valueD.setMinutes(valueD.getMinutes() - valueD.getTimezoneOffset());
      value = valueD.toISOString().slice(0, 16);
    }
    return value;
  }

  function inputToProject(value: string): string {
    if (type == "datetime-local" && value != "") {
      value = new Date(value).toISOString();
    }
    return value;
  }

  const commonProps = {
    key: id,
    name,
    value: projectToInput(project),
    id,
    onChange(e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) {
      const value = inputToProject(e.target.value);
      return setProject((project) => {
        if (project == null) project = {};
        return { ...project, [name]: value };
      });
    },
  };
  return (
    <>
      <label htmlFor={id}> {label} </label>
      {type == "textarea" ? (
        <textarea {...commonProps} />
      ) : (
        <input type={type} {...commonProps} />
      )}
    </>
  );
}

type ConfigFormProps = {
  project: string;
};

function ConfigForm(props: ConfigFormProps) {
  const projectId = props.project;
  const { project: initialProject, error: initialError } =
    ReactRouterDom.useLoaderData() as ProjectLoader;
  const [project, setProject] = React.useState<Partial<Project>>(
    initialProject || {}
  );
  const [error, setError] = React.useState<string | null>(initialError || null);
  const navigate = ReactRouterDom.useNavigate();

  return (
    <ProjectStateContext.Provider value={[project, setProject]}>
      {error == null ? null : <div className="error">{error}</div>}
      <form
        role="form"
        onSubmit={(e) => {
          e.preventDefault();
          void (async () => {
            const r = await fetch(`${WORKER_URL}/projects/${projectId}`, {
              method: "PUT",
              credentials: "include",
              body: JSON.stringify({ project: project }),
            });
            if (!r.ok) {
              setError(`${r.status} ${r.statusText}`);
            } else {
              setError(null);
              navigate(0); // reload
            }
          })();
        }}
      >
        <ProjectInput type="text" label="Funding Goal" />
        <ProjectInput type="datetime-local" label="Funding Deadline" />
        <ProjectInput type="text" label="Form Heading" />
        <ProjectInput type="textarea" label="Description" />
        <ProjectInput type="text" label="Author Name" />
        <ProjectInput type="text" label="Author Image Url" />
        <ProjectInput type="textarea" label="Author Description" />
        <input type="submit" value="Submit" />
      </form>
    </ProjectStateContext.Provider>
  );
}

export default App;
