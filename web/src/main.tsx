import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import { AppRouter } from "./app/router";
import { AuthProvider } from "./lib/auth";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } }
});

registerSW({ immediate: true });

function dismissSplash() {
  const splash = document.getElementById("app-splash");
  if (!splash) return;
  splash.classList.add("hide");
  window.setTimeout(() => splash.remove(), 280);
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AppRouter />
        </BrowserRouter>
      </QueryClientProvider>
    </AuthProvider>
  </React.StrictMode>
);

window.requestAnimationFrame(dismissSplash);
