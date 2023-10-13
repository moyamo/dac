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
import DOMPurify from "dompurify";
import { marked } from "marked";
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

type MarkdownProps = { markdown: string };

function Markdown({ markdown }: MarkdownProps) {
  return (
    <div
      dangerouslySetInnerHTML={{
        __html: DOMPurify.sanitize(marked.parse(markdown)),
      }}
    ></div>
  );
}

function RedirectToDemo() {
  const navigate = ReactRouterDom.useNavigate();
  const toUrl = "/projects/dac2023w35production";
  // prevent infinite loop
  const [triedToNavigate, setTriedToNavigate] = React.useState(false);

  React.useEffect(() => {
    if (!triedToNavigate) {
      navigate(toUrl, { replace: true });
      setTriedToNavigate(true);
    }
  }, [triedToNavigate]);
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
      path: "/projects/:projectId",
      loader: projectLoader,
      element: (
        <App
          PaypalButtons={PaypalButtons}
          headerParenthesis={headerParenthesis}
        />
      ),
    },
    {
      path: "/projects/:projectId/admin",
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
  const { projectId } = params;
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
  const { projectId } = ReactRouterDom.useParams();
  const { project, error: loaderError } =
    ReactRouterDom.useLoaderData() as ProjectLoader;
  if (typeof projectId === "undefined") throw Error("projectId undefined");
  const [funded, setFunded] = React.useState(false);
  const [amountRef, setAmount] = useStateRef(89);
  const [progress, setProgress] = React.useState(-1);

  const [orders, setOrders] = React.useState<Order[]>([]);

  React.useEffect(() => {
    void (async () => {
      const count = await fetch(`${WORKER_URL}/projects/${projectId}/counter`);
      const response = await count.json<CounterResponse>();
      setProgress(response.amount);
      setOrders(response.orders);
    })();
  }, [funded]);

  return (
    <>
      <header>
        <h1>{`Refund Bonus${
          headerParenthesis ? ` (${headerParenthesis})` : ""
        }`}</h1>
      </header>

      {typeof project == "undefined" ? (
        <div className="error"> {loaderError} </div>
      ) : (
        <>
          <form>
            <h2>{project.formHeading}</h2>
            <FundingProgressBar
              funded={funded}
              progress={progress}
              goal={Number(project.fundingGoal)}
            />
            {hasFundingDeadlinePassed(project.fundingDeadline) ? null : (
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
                      `${WORKER_URL}/projects/${projectId}/contract`,
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
                      `${WORKER_URL}/projects/${projectId}/contract/${data.orderID}`,
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
            <FundingTimer deadline={project.fundingDeadline} />
          </form>
          <Markdown markdown={project.description} />
          <div id="contact">
            <h2> {project.authorName} </h2>
            <img
              id="portrait"
              src={project.authorImageUrl}
              width="128"
              height="128"
            ></img>
            <div id="contact-content">
              <Markdown markdown={project.authorDescription} />
            </div>
          </div>
          <hr />
          <h2>Funders</h2>
          <FunderTable orders={orders} />
        </>
      )}
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
  const { projectId } = ReactRouterDom.useParams();
  if (typeof projectId === "undefined") throw Error("Project undefined");
  return (
    <>
      <h1>Admin App</h1>
      <h2>Pending Payouts</h2>
      <PendingPayoutsTable projectId={projectId} />
      <h2>Config</h2>
      <ConfigForm projectId={projectId} />
    </>
  );
}

type PendingPayoutsTableProps = {
  projectId: string;
};

function PendingPayoutsTable(props: PendingPayoutsTableProps) {
  const { projectId } = props;
  const [bonuses, setBonuses] = React.useState<Record<string, Bonus>>({});
  const [updates, setUpdates] = React.useState(0);
  React.useEffect(() => {
    void (async () => {
      const response = await fetch(
        `${WORKER_URL}/projects/${projectId}/bonuses`,
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
                      `${WORKER_URL}/projects/${projectId}/bonuses/${orderId}`,
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
  projectId: string;
};

function ConfigForm(props: ConfigFormProps) {
  const { projectId } = props;
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
