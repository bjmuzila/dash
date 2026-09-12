import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Dark only. index.html ships data-theme="dark"; this clears any stale
// preference a browser or an earlier build left behind, so no light override can
// match.
document.documentElement.setAttribute("data-theme", "dark");
try {
  localStorage.removeItem("theme");
} catch {
  /* private mode, blocked storage: nothing to clear */
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
