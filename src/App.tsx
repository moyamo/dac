import { FUNDING, PayPalButtonsComponentProps } from "@paypal/react-paypal-js";
import type {
  CreateOrderData,
  CreateOrderActions,
  OnApproveData,
  OnApproveActions,
  OnClickActions,
} from "@paypal/paypal-js/types/components/buttons";
import React from "react";
import "./App.css";
import type { CreateOrderResponse } from "./worker";
import { getInvalidAmountError } from "./common";

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
  const [amountRef, setAmount] = useStateRef(19);

  React.useEffect(() => {
    void (async () => {
      const refund = await fetch(WORKER_URL + "/refund");
      if (refund.ok) {
        setRefunded(true);
      }
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
          <form>
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
            <FundingProgressBar funded={funded} />
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
                const responseJson: CreateOrderResponse = await response.json();
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
          </form>
        </>
      )}
    </>
  );
}

export function FundingProgressBar({ funded }: { funded: boolean }) {
  const [progress, setProgress] = React.useState(-1);
  React.useEffect(() => {
    void (async () => {
      const count = await fetch(WORKER_URL + "/counter");
      setProgress((await count.json<{ amount: number }>()).amount);
    })();
  }, [funded]);
  return progress == -1 ? (
    <span>Loading...</span>
  ) : (
    <>
      <progress role="progressbar" value={progress} max={833} />
      {`$${progress} / $${833} funded!`}
      {funded ? " Thank you!" : null}
    </>
  );
}

export default App;
