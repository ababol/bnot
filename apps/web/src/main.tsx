import { createRoot } from "react-dom/client";
import App from "./app";
import "./index.css";
import { runUpdateCheck } from "./lib/updater";

createRoot(document.getElementById("root")!).render(<App />);

// Only auto-update in prod so `pnpm dev` and `pnpm build:dev` don't overwrite
// the local build. `import.meta.env.MODE` is "production" only for `vite build`
// (the default mode); `vite build --mode development` sets MODE="development"
// while PROD stays true, so we gate on MODE.
if (import.meta.env.MODE === "production") void runUpdateCheck();
