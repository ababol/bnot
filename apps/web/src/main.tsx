import { createRoot } from "react-dom/client";
import App from "./app";
import "./index.css";
import { runUpdateCheck } from "./lib/updater";

createRoot(document.getElementById("root")!).render(<App />);

// Only auto-update in prod so `pnpm dev` doesn't overwrite the local build.
if (import.meta.env.PROD) void runUpdateCheck();
