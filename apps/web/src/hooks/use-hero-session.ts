import { useSession } from "../context/session-context";
import type { AgentSession } from "../context/types";

export function useHeroSession(): AgentSession | undefined {
  const { state } = useSession();
  return state.heroSessionId ? state.sessions[state.heroSessionId] : undefined;
}
