import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import { AdminApp } from "./App";
import reportWebVitals from "./reportWebVitals";
import { BrowserRouter, Routes, Route } from "react-router-dom";

/* It seems like a client ID is unnecessary, let's just leave it out rather */

const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement
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
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/admin" element={<AdminApp />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
