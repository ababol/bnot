import { useSession } from "../context/session-context";
import type { ViewMode } from "../context/types";

const TABS: { id: ViewMode; label: string }[] = [
  { id: "sessions", label: "Sessions" },
  { id: "worktrees", label: "Worktrees" },
];

export default function TabBar() {
  const { state, dispatch } = useSession();
  return (
    <div className="flex items-center gap-0.5 rounded-md bg-white/5 p-0.5">
      {TABS.map((tab) => {
        const active = state.view === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => dispatch({ type: "SET_VIEW", view: tab.id })}
            className={`cursor-pointer rounded border-none px-2 py-0.5 text-[10px] font-semibold transition-colors ${
              active
                ? "bg-white/10 text-white"
                : "bg-transparent text-text-dim hover:text-text-muted"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
