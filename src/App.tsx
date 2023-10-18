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
import * as ReactOAuthGoogle from "@react-oauth/google";

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

const CredentialsContext = React.createContext<string | null>(null);

const SetCredentialsContext = React.createContext<(c: string | null) => void>(
  (_c) => null
);

async function authFetch(method: string, path: string, init?: RequestInit) {
  init = init ?? {};
  const credentials = localStorage.getItem("credentials"); // can't get context all the time
  let fetchParams: RequestInit = {};
  if (credentials != null && credentials.startsWith("admin:")) {
    fetchParams.headers = {
      Authorization: `Basic ${window.btoa(credentials)}`,
    };
  } else if (credentials != null) {
    fetchParams.headers = { Authorization: `Bearer ${credentials}` };
  } else {
    fetchParams.credentials = "include";
  }
  fetchParams.headers = { ...fetchParams.headers, ...init.headers };
  const initWithoutHeaders = { ...init };
  delete init.headers;
  fetchParams = { method, ...fetchParams, ...initWithoutHeaders };
  const response = await fetch(`${WORKER_URL}${path}`, fetchParams);
  if (response.status == 500) {
    const jsonBody: Record<string, unknown> = await response.json();
    if (jsonBody?.code == "ERR_JWT_EXPIRED") {
      return "logout";
    }
  }
  return response;
}

type TopLevelProps = {
  headerParenthesis?: string;
};

function TopLevel(props: TopLevelProps) {
  const { headerParenthesis } = props;
  const outlet = ReactRouterDom.useOutlet();
  const [credentials, setCredentialsState] = React.useState<string | null>(
    localStorage.getItem("credentials")
  );

  function setCredentials(credentials: string | null) {
    if (credentials == null) localStorage.removeItem("credentials");
    else localStorage.setItem("credentials", credentials);
    setCredentialsState(credentials);
  }

  return (
    <SetCredentialsContext.Provider value={setCredentials}>
      <CredentialsContext.Provider value={credentials}>
        <header>
          <h1>{`Refund Bonus${
            headerParenthesis ? ` (${headerParenthesis})` : ""
          }`}</h1>
        </header>
        {outlet == null ? <RedirectToDemo /> : outlet}
      </CredentialsContext.Provider>
    </SetCredentialsContext.Provider>
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
      element: <TopLevel headerParenthesis={headerParenthesis} />,
      children: [
        {
          path: "/login",
          element: <LoginPage />,
        },
        {
          path: "/adminLogin",
          element: <AdminLogin />,
        },
        {
          path: "/projects/:projectId",
          loader: projectLoader,
          element: <App PaypalButtons={PaypalButtons} />,
        },
        {
          path: "/projects/:projectId/admin",
          element: <AdminApp />,
        },
        {
          path: "/projects/:projectId/edit",
          loader: projectLoader,
          element: <EditApp />,
        },
      ],
    },
  ];
}

type ProjectLoader = { project?: Project; error?: string };

async function projectLoader({
  request,
  params,
}: LoaderFunctionArgs): Promise<ProjectLoader | Response> {
  const { projectId } = params;
  if (typeof projectId == "undefined") {
    return { error: "project undefined" };
  }
  const response = await authFetch("GET", `/projects/${projectId}`);
  if (response == "logout") {
    return ReactRouterDom.redirect(
      `/login?redirect=${new URL(request.url).pathname}&logout=true`
    );
  }
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
};

function App(props: AppProps) {
  const { PaypalButtons } = props;
  const { projectId } = ReactRouterDom.useParams();
  const { project, error: loaderError } =
    ReactRouterDom.useLoaderData() as ProjectLoader;
  if (typeof projectId === "undefined") throw Error("projectId undefined");
  const [funded, setFunded] = React.useState(false);
  const [amountRef, setAmount] = useStateRef(
    project?.defaultPaymentAmount ?? 89
  );
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
                {!project.isDraft ? null : (
                  <p>
                    This is a <strong>draft</strong> project. The PayPal button
                    will not work.
                    <ReactRouterDom.Link to="edit">
                      Click to here edit draft
                    </ReactRouterDom.Link>
                    .
                  </p>
                )}

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
                    if (project.isDraft) {
                      return actions.reject();
                    }
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
                        {`$${(
                          (amountRef.current *
                            (100.0 + project.refundBonusPercent)) /
                          100.0
                        ).toFixed(2)}`}
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

type UseState<T> = [T, React.Dispatch<React.SetStateAction<T>>];

const ProjectStateContext = React.createContext<UseState<Partial<Project>>>([
  {},
  (_mP) => null,
]);

const ProjectErrorContext = React.createContext<
  UseState<Record<string, string>>
>([{}, (_mP) => null]);

function ProjectInput({ type, label }: { type: string; label: string }) {
  const [project, setProject] = React.useContext(ProjectStateContext);
  const [projectError, setProjectError] = React.useContext(ProjectErrorContext);
  function onFirstChar(f: (s: string) => string) {
    // Returns function which applies f to first character of the first argument
    return (s: string) => f(s.slice(0, 1)) + s.slice(1);
  }
  const Name = label
    .split(" ")
    .map((w) => w.toLowerCase())
    .map(onFirstChar((c) => c.toUpperCase()))
    .join("");
  const name = onFirstChar((c) => c.toLowerCase())(Name) as keyof Project;
  const id = "ConfigForm" + Name;

  function projectToInput(project: Partial<Project>): string | number {
    let value = project[name] || "";
    if (type == "datetime-local" && value != "" && typeof value == "string") {
      // See https://stackoverflow.com/questions/30166338/setting-value-of-datetime-local-from-date
      const valueD = new Date(value);
      valueD.setMinutes(valueD.getMinutes() - valueD.getTimezoneOffset());
      value = valueD.toISOString().slice(0, 16);
    }
    // This is just to get the code to type check
    if (typeof value == "boolean") {
      return value ? "true" : "false";
    }
    return value;
  }

  function inputToProject(value: string | number): string | number | boolean {
    if (type == "datetime-local" && value != "" && typeof value == "string") {
      value = new Date(value).toISOString();
    }
    if (type == "number" && typeof value == "string") {
      value = Number(value);
    }
    return value;
  }

  const errorMessage =
    project[name] == "" || project[name] == null
      ? `Please enter a ${label}`
      : null;
  const errorMessageId = `${id}Error`;

  // It's better to call setState in useEffect and not while rendering.
  React.useEffect(() => {
    if (errorMessage != projectError[name]) {
      setProjectError((projectError) => {
        if (errorMessage == null) {
          delete projectError[name];
        } else {
          projectError[name] = errorMessage;
        }
        return projectError;
      });
    }
  }, [project]);

  const commonProps = {
    key: id,
    name,
    value: projectToInput(project),
    id,
    ["aria-required"]: true,
    ["aria-invalid"]: errorMessage ? true : false,
    ["aria-describedby"]: errorMessage ? errorMessageId : undefined,
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
      {errorMessage ? (
        <div id={errorMessageId} className="error">
          {errorMessage}
        </div>
      ) : null}
    </>
  );
}

function EditApp() {
  const { projectId } = ReactRouterDom.useParams();
  if (typeof projectId == "undefined") throw Error("projectId undefined");
  const { project: initialProject, error: initialError } =
    ReactRouterDom.useLoaderData() as ProjectLoader;
  const [project, setProject] = React.useState<Partial<Project>>(
    initialProject || {}
  );
  const [projectError, setProjectError] = React.useState<
    Record<string, string>
  >({});
  const [error, setError] = React.useState<string | null>(initialError || null);
  const errorRef = React.createRef<HTMLDivElement>();
  const navigate = ReactRouterDom.useNavigate();
  const location = ReactRouterDom.useLocation();
  const url = location.pathname ?? "/";

  React.useEffect(() => {
    if (error == "401 Unauthorized") {
      navigate(`/login?redirect=${url}`);
    }
  }, [error]);

  return (
    <ProjectStateContext.Provider value={[project, setProject]}>
      <ProjectErrorContext.Provider value={[projectError, setProjectError]}>
        <h2>Edit Project</h2>
        {error == null ? null : (
          <div ref={errorRef} className="error">
            {error}
          </div>
        )}
        <form
          role="form"
          onSubmit={(e) => {
            e.preventDefault();
            if (Object.keys(projectError).length > 0) {
              const errorKey = Object.keys(projectError)[0];
              setError(projectError[errorKey]);
              window.scrollTo(0, 0);
              return;
            }
            if (typeof project.isDraft == "undefined") {
              // This GET /projects/:projectId returned 404, so the project is new
              project.isDraft = true;
            }
            void (async () => {
              const r = await authFetch("PUT", `/projects/${projectId}`, {
                body: JSON.stringify({ project: project }),
              });
              if (r == "logout") {
                navigate(`/login?redirect=${url}&logout=true`);
              } else if (!r.ok) {
                setError(`${r.status} ${r.statusText}`);
              } else {
                setError(null);
                navigate("..", { relative: "path" }); // View Project
              }
            })();
          }}
        >
          <ProjectInput type="text" label="Funding Goal" />
          <ProjectInput type="datetime-local" label="Funding Deadline" />
          <ProjectInput type="number" label="Refund Bonus Percent" />
          <ProjectInput type="number" label="Default Payment Amount" />
          <ProjectInput type="text" label="Form Heading" />
          <ProjectInput type="textarea" label="Description" />
          <ProjectInput type="text" label="Author Name" />
          <ProjectInput type="text" label="Author Image URL" />
          <ProjectInput type="textarea" label="Author Description" />
          <input type="submit" value="Submit" />
        </form>
        <h3> Users who can edit this project </h3>
        <AclEditor resource={`/projects/${projectId}`} permissions={["edit"]} />
      </ProjectErrorContext.Provider>
    </ProjectStateContext.Provider>
  );
}

type AclEditorProps = {
  resource: string;
  permissions: Array<string>;
};

function AclEditor(props: AclEditorProps) {
  const { resource, permissions } = props;
  const [user, setUser] = React.useState("");
  type Grants = { [user: string]: Array<string> };
  const [grants, setGrants] = React.useState<Grants>({});

  async function grantsFromResponse(r: Response | "logout"): Promise<Grants> {
    if (r == "logout") {
      return { "permission denied": ["permission denied"] };
    } else if (r.ok) {
      const response = await r.json<{ grants: Grants }>();
      return response.grants;
    } else {
      return { [`${r.status}`]: [`${r.statusText}`] };
    }
  }

  React.useEffect(() => {
    void (async () => {
      const r = await authFetch("GET", `/acls/grants?resource=${resource}`);
      setGrants(await grantsFromResponse(r));
    })();
  }, [resource]);

  return (
    <>
      <ul>
        {Object.entries(grants).map(([user, permissions]) =>
          permissions.includes("edit") ? <li key={user}>{user}</li> : null
        )}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void (async () => {
            const r = await authFetch("POST", `/acls/grants`, {
              body: JSON.stringify({
                grant: {
                  resource,
                  permissions,
                  user,
                },
              }),
            });
            setGrants(await grantsFromResponse(r));
          })();
        }}
      >
        <label> Email </label>
        <input
          type="text"
          value={user}
          onChange={(e) => setUser(e.target.value)}
        />
        <input type="submit" value="Share Edit Access" />
      </form>
    </>
  );
}

function LoginPage() {
  const credentials = React.useContext(CredentialsContext);
  const setCredentials = React.useContext(SetCredentialsContext);
  const [searchParams, setSearchParams] = ReactRouterDom.useSearchParams();
  const redirectQuery = searchParams.get("redirect");
  const logoutQuery = searchParams.get("logout");
  const navigate = ReactRouterDom.useNavigate();

  function logout() {
    ReactOAuthGoogle.googleLogout();
    setCredentials(null);
  }

  React.useEffect(() => {
    if (credentials != null && redirectQuery != null && logoutQuery == null) {
      navigate(redirectQuery);
    } else if (credentials != null && logoutQuery != null) {
      setSearchParams((searchParams) => {
        searchParams.delete("logout");
        return searchParams;
      });
      logout();
    }
  }, [credentials, redirectQuery, logoutQuery]);

  return (
    <>
      <form>
        <h2> Login </h2>
        {credentials != null ? (
          <button
            onClick={(e) => {
              e.preventDefault();
              logout();
            }}
          >
            Logout
          </button>
        ) : (
          <ReactOAuthGoogle.GoogleLogin
            onSuccess={(credentialResponse) => {
              setCredentials(credentialResponse.credential ?? null);
            }}
            onError={() => {
              console.log("Login Failed");
              setCredentials(null);
            }}
          />
        )}
        To register contact the site administrator.
      </form>
    </>
  );
}

function AdminLogin() {
  const credentials = React.useContext(CredentialsContext);
  const setCredentials = React.useContext(SetCredentialsContext);
  const [password, setPassword] = React.useState<string>("");

  return (
    <>
      <form>
        <h2> AdminLogin </h2>

        {credentials != null ? (
          <button
            onClick={(e) => {
              e.preventDefault();
              setCredentials(null);
            }}
          >
            Logout
          </button>
        ) : (
          <>
            <label> Password </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />

            <button
              onClick={(e) => {
                e.preventDefault();
                setCredentials(`admin:${password}`);
              }}
            >
              Log-in
            </button>
          </>
        )}
      </form>
    </>
  );
}

export default App;
