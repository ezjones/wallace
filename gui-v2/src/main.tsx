import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./globals.css";

function showFatal(prefix: string, detail: string) {
  const d = document.createElement("pre");
  d.style.cssText =
    "position:fixed;inset:8px;z-index:9999;color:#ff8080;background:#000;" +
    "padding:12px;font:12px monospace;white-space:pre-wrap;border:1px solid #f44;";
  d.textContent = prefix + detail;
  document.body.appendChild(d);
}
window.addEventListener("error", (e) =>
  showFatal("ERR: " + e.message + "\n", String((e as ErrorEvent).error?.stack ?? ""))
);
window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) =>
  showFatal("REJECTION:\n", String((e.reason as Error)?.stack ?? e.reason))
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
