import {
  PayPalScriptProvider,
  PayPalButtons,
  FUNDING,
} from "@paypal/react-paypal-js";
import type {
  CreateOrderData,
  CreateOrderActions,
  OnApproveData,
  OnApproveActions,
} from "@paypal/paypal-js/types/components/buttons";
import React from "react";
import "./App.css";
import type { CreateOrderResponse } from "./worker";

/* It seems like a client ID is unnecessary, let's just leave it out rather */
const CLIENT_ID = "test";
export const WORKER_URL =
  process.env.REACT_APP_WORKER_URL || "http://localhost:8787";

export async function createOrder(
  data: CreateOrderData,
  actions: CreateOrderActions
) {
  console.log("created order");
  console.log("data");
  console.dir(data);
  console.log("actions");
  console.dir(actions);
  const response = await fetch(WORKER_URL + "/contract", {
    method: "POST",
  });
  console.dir(response);
  const responseJson: CreateOrderResponse = await response.json();
  console.dir("got response");
  console.dir(responseJson);
  return responseJson.id;
}

export function onApprove(setFunded: (funded: boolean) => void) {
  return async (data: OnApproveData, actions: OnApproveActions) => {
    console.log("order approved");
    console.dir(data);
    console.log("actions");
    console.dir(actions);
    const response = await fetch(WORKER_URL + "/contract/" + data.orderID, {
      method: "PATCH",
    });
    console.log("got response");
    console.dir(response);
    const responseJson = await response.json();
    console.log("responseJson");
    console.dir(responseJson);
    setFunded(true);
  };
}

function App() {
  const [funded, setFunded] = React.useState(false);
  const [refunded, setRefunded] = React.useState(false);
  React.useEffect(() => {
    void (async () => {
      const refund = await fetch(WORKER_URL + "/refund");
      if (refund.ok) {
        setRefunded(true);
      }
    })();
  }, [funded]);
  return (
    /* From [react-paypal-js documentation][1]. Context Provider - this
     * <PayPalScriptProvider /> component manages loading the JS SDK script. Add
     * it to the root of your React app. It uses the Context API for managing
     * state and communicating to child components. It also supports reloading
     * the script when parameters change.
     *
     * [1]: https://www.npmjs.com/package/@paypal/react-paypal-js
     */
    <PayPalScriptProvider options={{ "client-id": CLIENT_ID }}>
      <h1>Dominant Assurance Contract Prototype</h1>
      <p>
        This is a prototype of dominant assurance contracts using Paypal&apos;s
        API with Cloudflare Pages.
      </p>
      {refunded ? (
        "Sorry, the project did not reach the goal. The money is been refunded"
      ) : (
        <>
          <FundingProgressBar funded={funded} />
          <PayPalButtons
            fundingSource={
              /* Don't allow weird sources, because I may Paypal the money back */
              FUNDING.PAYPAL
            }
            createOrder={createOrder}
            onApprove={onApprove(setFunded)}
          />
        </>
      )}
    </PayPalScriptProvider>
  );
}

export function FundingProgressBar({ funded }: { funded: boolean }) {
  const [progress, setProgress] = React.useState(-1);
  React.useEffect(() => {
    void (async () => {
      const count = await fetch(WORKER_URL + "/counter");
      setProgress(Number(await count.text()));
    })();
  }, [funded]);
  return progress == -1 ? (
    <span>Loading...</span>
  ) : (
    <>
      <progress role="progressbar" value={19 * progress} max={13 * 19} />
      {`$${19 * progress} / $${13 * 19} funded!`}
      {funded ? " Thank you!" : null}
    </>
  );
}

export default App;
