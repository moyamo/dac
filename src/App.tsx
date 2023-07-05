import React from "react";
import Countdown from "react-countdown";
import "./App.css";
import type {
  Bonus,
  BonusesResponse,
  CounterResponse,
  ManualOrder,
  ManualOrdersResponse,
  Order,
} from "./worker";
import { hasFundingDeadlinePassed } from "./common";

export const WORKER_URL =
  process.env.REACT_APP_WORKER_URL || "http://localhost:8787";

function App() {
  const [progress, setProgress] = React.useState(-1);
  const [fundingGoal, setFundingGoal] = React.useState(-1);
  const [fundingDeadline, setFundingDeadline] = React.useState("");
  const [lastUpdated, setLastUpdated] = React.useState<string | null>(null);

  const [orders, setOrders] = React.useState<Order[]>([]);

  React.useEffect(() => {
    void (async () => {
      const count = await fetch(WORKER_URL + "/counter");
      const response = await count.json<CounterResponse>();
      setProgress(response.amount);
      setOrders(response.orders);
      setFundingGoal(response.fundingGoal);
      setFundingDeadline(response.fundingDeadline);
      setLastUpdated(response.lastUpdated);
    })();
  }, []);

  return (
    <>
      <h1>
        <center>Refund Bonus</center>
      </h1>
      <hr />
      <h2>
        <center>Berkeley House Dinners</center>
      </h2>
      <FundingProgressBar
        funded={false}
        progress={progress}
        goal={fundingGoal}
        lastUpdated={lastUpdated}
      />
      <div style={{ margin: "1em 1em" }}>
        <FundingTimer deadline={fundingDeadline} />
      </div>
      <hr />
      <p>
        At <a href="https://twitter.com/andromeda_house">Andromeda House</a> we
        plan to host large weekly dinners on Monday evenings for the local
        EA/rationality/etc community at our house in Southside Berkeley.
      </p>
      <p>Here’s how it works:</p>
      <ul>
        <li>
          You can{" "}
          <a href="https://venmo.com/?txn=pay&audience=public&recipients=Arjun-Panickssery&amount=20&note=dinner">
            Venmo me
          </a>{" "}
          (@Arjun-Panickssery if the link doesn&apos;t work) or{" "}
          <a href="https://paypal.me/arjunpanickssery">PayPal me</a> any amount
          of at least $20 with the subject line &quot;dinner&quot; or similar.
        </li>
        <li>
          If I get at least $700 total by noon Pacific time on July 15,
          I&apos;ll host dinners from July 17 till the end of August (seven
          dinners).
        </li>

        <li>
          If I get less than $700 total, I&apos;ll give you a 25% return (e.g.,
          if you sent me $100, I&apos;ll send you back $125).
        </li>
      </ul>
      See{" "}
      <a href="https://www.lesswrong.com/posts/nwjTPtbvcJeA6xDuu/dominant-assurance-contract-experiment-2-berkeley-house">
        Dominant Assurance Contract Experiment #2: Berkeley House Dinners
      </a>{" "}
      for more details.
      {
        <>
          <form>
            {hasFundingDeadlinePassed(fundingDeadline) ? null : <></>}
          </form>
          <h3>
            Funders{" "}
            <small>
              <a href="/admin">Edit</a>
            </small>
          </h3>
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
  lastUpdated: string | null;
};

export function FundingProgressBar(props: FundingProgressBarProps) {
  const { funded, progress, goal, lastUpdated } = props;
  return progress == -1 ? (
    <span>Loading...</span>
  ) : (
    <div style={{ margin: "0 1em" }}>
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
      &nbsp;&nbsp;
      <i>
        <small>
          Last Updated:{" "}
          {lastUpdated == null ? "never" : formatTime(lastUpdated)}
        </small>
      </i>
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
        <center>
          <span style={{ fontSize: "32px" }}>
            <CountdownDefault date={new Date(deadline)} />
          </span>
        </center>
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
  return (
    <>
      <h1>Admin App</h1>
      <h2>Manual Orders</h2>
      <ManualOrdersTable />
      <h2>Pending Payouts</h2>
      <PendingPayoutsTable />
    </>
  );
}

export function PendingPayoutsTable() {
  const [bonuses, setBonuses] = React.useState<Record<string, Bonus>>({});
  const [updates, setUpdates] = React.useState(0);
  React.useEffect(() => {
    void (async () => {
      const response = await fetch(WORKER_URL + "/bonuses", {
        credentials: "include",
      });
      const bonuses = await response.json<BonusesResponse>();
      setBonuses(bonuses.bonuses || {});
    })();
  }, [updates]);

  return (
    <table>
      <thead>
        <tr>
          <th> Email </th>
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
                    const r = await fetch(`${WORKER_URL}/bonuses/${orderId}`, {
                      method: "DELETE",
                      credentials: "include",
                    });
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

export function ManualOrdersTable() {
  const [manualOrders, setManualOrders] = React.useState<
    Record<string, ManualOrder>
  >({});
  const [updates, setUpdates] = React.useState(0);
  React.useEffect(() => {
    void (async () => {
      const response = await fetch(WORKER_URL + "/manualOrders", {
        credentials: "include",
      });
      const r = await response.json<ManualOrdersResponse>();
      setManualOrders(r.manualOrders || {});
    })();
  }, [updates]);

  return (
    <div>
      <table>
        <thead>
          <tr>
            <th> Time ({getLocalTimezoneShortName()}) </th>
            <th>Platform</th>
            <th> User ID </th>
            <th> Name </th>
            <th> Amount ($) </th>
            <th> Delete </th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(manualOrders).map(([orderId, m]) => (
            <tr key={orderId}>
              <td> {formatTime(m.time)}</td>
              <td> {m.platform} </td>
              <td> {m.userId} </td>
              <td> {m.name} </td>
              <td> {m.amount} </td>
              <td>
                <button
                  onClick={() =>
                    void (async () => {
                      const r = await fetch(
                        `${WORKER_URL}/manualOrders/${orderId}`,
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
      <form
        role="form"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.target as HTMLFormElement;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const body: any = Object.fromEntries(new FormData(form));
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          body["amount"] = Number(body["amount"]);
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
          body["time"] = new Date(body["time"]).toISOString();
          void (async () => {
            const r = await fetch(`${WORKER_URL}/manualOrders`, {
              method: "POST",
              credentials: "include",
              body: JSON.stringify(body),
            });
            if (!r.ok) {
              alert(`${r.status} ${r.statusText}`);
            }
            setUpdates((updates) => updates + 1);
          })();
        }}
      >
        <label htmlFor="manualOrderTime"> Time </label>
        <input type="datetime-local" name="time" id="manualOrderTime" />
        <label htmlFor="manualOrderPlatform"> Platform </label>
        <select name="platform" id="manualOrderPlatform">
          <option value="paypal">PayPal</option>
          <option value="venmo">Venmo</option>
        </select>
        <label htmlFor="manualOrderUserId"> User ID </label>
        <input type="text" name="userId" id="manualOrderUserId" />
        <label htmlFor="manualOrderName"> Name </label>
        <input type="text" name="name" id="manualOrderName" />
        <label htmlFor="manualOrderAmount"> Amount ($) </label>
        <input type="number" name="amount" id="manualOrderAmount" />
        <input type="submit" />
      </form>
    </div>
  );
}

export default App;
