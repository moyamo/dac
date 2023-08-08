import { FUNDING, PayPalButtonsComponentProps } from "@paypal/react-paypal-js";
import type {
  CreateOrderData,
  CreateOrderActions,
  OnApproveData,
  OnApproveActions,
  OnClickActions,
} from "@paypal/paypal-js/types/components/buttons";
import React from "react";
import Countdown from "react-countdown";
import "./App.css";
import type {
  Bonus,
  BonusesResponse,
  CounterResponse,
  CreateOrderResponse,
  Order,
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

export type AppProps = {
  PaypalButtons: React.FunctionComponent<PayPalButtonsComponentProps>;
};

function App(props: AppProps) {
  const { PaypalButtons } = props;
  const [funded, setFunded] = React.useState(false);
  const [refunded, setRefunded] = React.useState(false);
  const [amountRef, setAmount] = useStateRef(89);
  const [progress, setProgress] = React.useState(-1);
  const [fundingGoal, setFundingGoal] = React.useState(-1);
  const [fundingDeadline, setFundingDeadline] = React.useState("");

  const [orders, setOrders] = React.useState<Order[]>([]);

  React.useEffect(() => {
    void (async () => {
      const refund = await fetch(WORKER_URL + "/refund");
      if (refund.ok) {
        setRefunded(true);
      }
    })();
  }, [funded]);

  React.useEffect(() => {
    void (async () => {
      const count = await fetch(WORKER_URL + "/counter");
      const response = await count.json<CounterResponse>();
      setProgress(response.amount);
      setOrders(response.orders);
      setFundingGoal(response.fundingGoal);
      setFundingDeadline(response.fundingDeadline);
    })();
  }, [funded]);

  return (
    <>
      <h1>
        <center>Refund Bonus</center>
      </h1>
      <hr />
      <h3>
        {" "}
        Yaseen is creating a platform for raising money for giving away products
        for free{" "}
      </h3>
      {refunded ? (
        "Sorry, the project did not reach the goal. The money is been refunded"
      ) : (
        <>
          <FundingTimer deadline={fundingDeadline} />
          <form>
            {hasFundingDeadlinePassed(fundingDeadline) ? null : (
              <>
                <label htmlFor="amount">Amount</label>
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
                <p>
                  {getInvalidAmountError(amountRef.current) ||
                    `Thanks for pledging $${
                      amountRef.current
                    }! If we do not reach our goal you will get a $${(
                      amountRef.current * 1.2
                    ).toFixed(2)} refund!`}
                </p>
              </>
            )}
            <FundingProgressBar
              funded={funded}
              progress={progress}
              goal={fundingGoal}
            />
            {hasFundingDeadlinePassed(fundingDeadline) ? null : (
              <>
                <PaypalButtons
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
                    const response = await fetch(WORKER_URL + "/contract", {
                      method: "POST",
                      body: JSON.stringify({ amount: amountRef.current }),
                    });
                    const responseJson: CreateOrderResponse =
                      await response.json();
                    console.dir(responseJson);
                    return responseJson.id;
                  }}
                  onApprove={async (
                    data: OnApproveData,
                    actions: OnApproveActions
                  ) => {
                    console.log("order approved");
                    console.dir(data);
                    console.log("actions");
                    console.dir(actions);
                    const response = await fetch(
                      WORKER_URL + "/contract/" + data.orderID,
                      {
                        method: "PATCH",
                      }
                    );
                    console.log("got response");
                    console.dir(response);
                    const responseJson = await response.json();
                    console.log("responseJson");
                    console.dir(responseJson);
                    setFunded(true);
                  }}
                />
              </>
            )}
          </form>
          <hr />
          <h3>How to give things away for free and get paid doing it </h3>
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
          <h4>Details</h4>
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
            <li>Has a description of the project.</li>
            <li>Has a progress bar showing how much and who have pledged.</li>
            <li>Handles payments with PayPal</li>
            <li>
              If the project doesn&apos;t reach the funding goal, the customers
              are automatically refunded with a refund bonus. If the project
              does reach it&apos;s goal, the producer gets the money in their
              PayPal account.
            </li>
            <li>
              The producer will put up the refund bonus as collateral using
              PayPal.
            </li>
          </ul>
          <p>
            The website is essentially already done. (You are looking at the
            prototype now!). I just need to flesh it out so that other people
            can upload their projects. The main thing I&apos;m going to doing is
            looking for people who want to create public goods and getting
            feedback from them on the platform (if that&apos;s you please hit me
            up) [TODO insert contact details] Additionally I want to try some
            cool things which might not work out like
          </p>
          <ul>
            <li>Use prediction markets to price the project.</li>
            <li>
              Bring in investors/advertisers who will put up the collateral on
              behalf of the producers and take a cut if the project succeeds.
            </li>
          </ul>
          [TODO Link to twitter, discord, or email or something[
          <h4>
            &ldquo;Wait, how will giving you money make Game-of-Thrones quality
            shows on freely available on YouTube?&rdquo;
          </h4>
          <p>
            If you have an idea for a great show, instead of pitching it to
            holywood executives, you could pitch it to the public and have them
            crowdfund it. Then after you produce it you give it away for free.{" "}
          </p>
          <h4>
            I have questions or how do I know you are not going to steal my
            money?
          </h4>
          <p>
            Here is social proof and my contact details ask for questions, and a
            transparent list of funders
          </p>
          <hr />
          <h3>Funders</h3>
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
    <>
      <progress role="progressbar" value={progress} max={goal} />
      {`$${progress} / $${goal} funded!`}
      {funded ? " Thank you!" : null}
    </>
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
      <span>
        Funding closing on {formatTime(deadline)}.{" "}
        <CountdownDefault date={new Date(deadline)} />{" "}
      </span>
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
      <h2>Pending Payouts</h2>
      <PendingPayoutsTable />
    </>
  );
}

function PendingPayoutsTable() {
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

export default App;
