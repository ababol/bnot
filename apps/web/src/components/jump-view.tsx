import { useSession } from "../context/session-context";
import { directoryName } from "../context/types";
import { useHeroSession } from "../hooks/use-hero-session";
import { jumpToSession, setPanelState } from "../lib/tauri";

interface Props {
  notchHeight: number;
}

export default function JumpView({ notchHeight }: Props) {
  const { dispatch } = useSession();
  const heroSession = useHeroSession();

  const dirName = heroSession ? directoryName(heroSession) : "Task";

  const jump = () => {
    if (heroSession) jumpToSession(heroSession.id);
    setPanelState(dispatch, "compact");
  };

  return (
    <div
      onClick={jump}
      className="flex h-full w-full cursor-pointer flex-col items-center justify-center gap-4 rounded-[10px] bg-black px-3"
    >
      <div className="shrink-0" style={{ height: notchHeight / 2 }} />

      <span className="text-[32px] text-buddy-green">&#x2713;</span>

      <div className="text-center">
        <div className="text-base font-bold text-white">Done</div>
        <div className="mt-1 font-mono text-xs text-text-dim">
          {heroSession?.taskName ?? dirName}
        </div>
      </div>

      <button
        onClick={jump}
        className="flex w-4/5 cursor-pointer items-center justify-center gap-1.5 rounded-[10px] border-none bg-buddy-blue/30 py-2.5 text-[13px] font-medium text-white hover:bg-buddy-blue/40"
      >
        {"\u2197"} Jump to terminal
      </button>
    </div>
  );
}
