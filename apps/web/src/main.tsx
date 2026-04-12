import { createRoot } from "react-dom/client";
import App from "./app";
import "./index.css";
import { runUpdateCheck } from "./lib/updater";

createRoot(document.getElementById("root")!).render(<App />);

void runUpdateCheck();
