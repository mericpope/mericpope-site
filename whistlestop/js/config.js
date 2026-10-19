// Base URL of the live-data proxy (see proxy/README.md). While null, the app
// runs on the built-in estimate model and labels every price EST.
//
//   GET {LIVE_PROVIDER_URL}/flight?from=CDG,LHR&to=JFK&date=2026-12-10&pairs=CDG-JFK,LHR-JFK
//   GET {LIVE_PROVIDER_URL}/hotel?q=hotels near Heathrow&checkin=2026-12-09&checkout=2026-12-10
//
// After deploying the Worker, put its URL here, e.g.
//   export const LIVE_PROVIDER_URL = "https://whistlestop-api.YOURNAME.workers.dev";
const DEPLOYED = "https://whistlestop-api.mericpope.workers.dev";

// Developer convenience: on localhost only, ?live=http://localhost:8787 points
// the page at a local proxy without editing this file. Ignored everywhere else.
const isLocal = typeof location !== "undefined" && ["localhost", "127.0.0.1"].includes(location.hostname);
const override = isLocal ? new URLSearchParams(location.search).get("live") : null;

export const LIVE_PROVIDER_URL = override || DEPLOYED;
