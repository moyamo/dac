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
import type { CounterResponse, CreateOrderResponse, Order } from "./worker";
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
      <h1>Dominant Assurance Contract Prototype</h1>
      <p>
        This is a prototype of dominant assurance contracts using Paypal&apos;s
        API with Cloudflare Pages.
      </p>
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

export default App;
