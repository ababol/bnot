import { useSession } from "../context/session-context";
import ApprovalView from "./approval-view";
import AskView from "./ask-view";
import CompactView from "./compact-view";
import JumpView from "./jump-view";
import OverviewView from "./overview-view";

interface NotchGeometry {
  centerX: number;
  topY: number;
  notchWidth: number;
  notchHeight: number;
}

export default function NotchContent({ geometry }: { geometry: NotchGeometry }) {
  const { state } = useSession();

  switch (state.panelState) {
    case "compact":
      return <CompactView notchWidth={geometry.notchWidth} />;
    case "jump":
      return <JumpView notchHeight={geometry.notchHeight} />;
    case "overview":
      return <OverviewView notchHeight={geometry.notchHeight} />;
    case "approval":
      return <ApprovalView notchHeight={geometry.notchHeight} />;
    case "ask":
      return <AskView notchHeight={geometry.notchHeight} />;
  }
}
