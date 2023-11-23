import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import * as MyApp from "./App";
import reportWebVitals from "./reportWebVitals";
import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { GoogleOAuthProvider } from "@react-oauth/google";

export const PAYPAL_CLIENT_ID =
  process.env.REACT_APP_PAYPAL_CLIENT_ID || "test";

export const HEADER_PARENTHESIS =
  process.env.REACT_APP_HEADER_PARENTHESIS || "";

export const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID || "";

export const PROJECT_APPLICATION_FORM =
  process.env.REACT_APP_PROJECT_APPLICATION_FORM || "";

const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement
);

const router = createBrowserRouter(
  MyApp.routes({
    PaypalButtons: PayPalButtons,
    headerParenthesis: HEADER_PARENTHESIS,
    projectApplicationForm: PROJECT_APPLICATION_FORM,
  })
);

root.render(
  <React.StrictMode>
    {/* From [react-paypal-js documentation][1]. Context Provider - this
     * <PayPalScriptProvider /> component manages loading the JS SDK script. Add
     * it to the root of your React app. It uses the Context API for managing
     * state and communicating to child components. It also supports reloading
     * the script when parameters change.
     *
     * [1]: https://www.npmjs.com/package/@paypal/react-paypal-js
     */}
    <PayPalScriptProvider options={{ "client-id": PAYPAL_CLIENT_ID }}>
      <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
        <RouterProvider router={router} />
      </GoogleOAuthProvider>
    </PayPalScriptProvider>
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
