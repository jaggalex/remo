import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { HelpPage } from "./help/HelpPage";
import { I18nProvider } from "./i18n";
// Design-system tokens, self-hosted Inter and component styles. The product's own
// stylesheet comes second and stays unlayered, so it can override the package
// without specificity games (ADR-078).
import "@remo/ui/styles.css";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("root container missing");

// Public help is rendered before the board shell, so it works without a session
// (ADR-081). It is a static, bundled page, not a second application.
if (window.location.pathname === "/help" || window.location.pathname.startsWith("/help/")) {
  createRoot(container).render(
    <StrictMode>
      <I18nProvider>
        <HelpPage />
      </I18nProvider>
    </StrictMode>,
  );
} else if (import.meta.env.DEV && window.location.pathname.startsWith("/__ds")) {
  // The design-system catalogue is a dev-only route (spec/design-system.md §9): it never
  // ships in a production build, and loading it does not pull @remo/ui styles into the app.
  void import("./ds/Catalog").then(({ mountCatalog }) => mountCatalog(container));
} else {
  createRoot(container).render(
    <StrictMode>
      <I18nProvider>
        <App />
      </I18nProvider>
    </StrictMode>,
  );
}
