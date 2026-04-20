import { Plus } from "lucide-react";
import { useState } from "react";

type FaqItem = { q: string; a: string };

const FAQS: FaqItem[] = [
  {
    q: "Which terminals does Bnot support?",
    a: "Bnot is optimized for Ghostty (best fidelity for tab focus and keystroke injection). iTerm and Warp work, with reduced fidelity for tab/pane jumping. Native macOS Terminal is not officially supported.",
  },
  {
    q: "Does my data leave my machine?",
    a: "No. Bnot reads sessions locally via process scanning and Claude Code's hook system. Nothing is sent to a server, no telemetry, no analytics. Source is open under FSL; read it yourself.",
  },
  {
    q: "How is Bnot different from other Vibe Code notch apps?",
    a: "Bnot is built exclusively for Claude Code, not a generic \u201CAI agent\u201D wrapper. That focus lets us tune every surface (exact token counts, diff-aware approvals, plan-mode badges, /color tab sync) around Claude Code's real behavior instead of a lowest-common-denominator API. And Bnot doesn't stop at the notch: the optional Chrome extension adds an Open in worktree button on GitHub PR pages, so your notch and your code-review flow share the same muscle memory.",
  },
  {
    q: "Can I approve permission requests without switching to the terminal?",
    a: "Yes, that's the whole point. When Claude Code asks for approval on a dangerous tool (Bash, Edit, Write, etc.), Bnot surfaces the diff or command in the notch panel. You can Approve, Allow Always, or Deny inline.",
  },
  {
    q: "Will this slow down my Mac?",
    a: "Barely. Bnot polls for sessions every few seconds and idles the moment your terminal goes quiet. Built on Tauri with a small Node sidecar, it sips memory and stays out of your way until something actually needs your attention.",
  },
  {
    q: "Does it work on external monitors?",
    a: "Bnot pins to the built-in MacBook display (where the notch lives). On external monitors, the notch UX doesn't apply, but you can still hit the global shortcut to bring up the overview panel anywhere.",
  },
  {
    q: "How do I install it?",
    a: "Download the .dmg from the Releases page, drag Bnot.app to /Applications, launch it. Bnot auto-updates in the background. macOS 14 or later required.",
  },
];

export function Faq() {
  return (
    <section id="faq" className="relative w-full px-6 py-32 sm:py-40">
      <div className="mx-auto max-w-[700px] text-center mb-20">
        <h2 className="text-5xl font-semibold leading-none tracking-normal text-text-primary">
          FAQs
        </h2>
        <p className="mt-5 text-xl font-medium text-text-secondary">
          You've got questions. We've got answers
        </p>
      </div>

      {/* Top "spotlight" border that fades from transparent at the edges
          to subtle white in the middle, plus a soft radial glow that
          anchors the section. */}
      <div
        className="mx-auto max-w-[700px] pt-12 border-t
          bg-[radial-gradient(49.41%_64.58%_at_49.4%_0%,rgb(255_255_255/0.03)_0%,transparent_100%)]
          [border-image-source:linear-gradient(90deg,transparent_0%,rgb(255_255_255/0.19)_30%,rgb(255_255_255/0.19)_70%,transparent_100%)]
          [border-image-slice:1]"
      >
        {FAQS.map((item, i) => (
          <FaqRow key={item.q} item={item} defaultOpen={i === 0} />
        ))}
      </div>
    </section>
  );
}

function FaqRow({ item, defaultOpen }: { item: FaqItem; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      className="border-b last:border-b-0
        [border-image-source:linear-gradient(90deg,rgb(255_255_255/0.025)_0%,rgb(255_255_255/0.1)_40%,rgb(255_255_255/0.1)_60%,rgb(255_255_255/0.025)_100%)]
        [border-image-slice:1]"
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-6 pt-8 pb-6 text-left outline-none cursor-pointer"
        aria-expanded={open}
      >
        <span className="pr-4 text-base font-semibold text-text-primary">{item.q}</span>
        <Plus
          className={[
            "h-5 w-5 shrink-0 text-text-muted transition-transform duration-200",
            open ? "rotate-45 text-text-primary" : "",
          ].join(" ")}
          strokeWidth={1.5}
        />
      </button>
      <div
        className={[
          "grid transition-all duration-300 ease-out",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        ].join(" ")}
      >
        <div className="overflow-hidden">
          <p className="pb-6 pr-10 text-base leading-relaxed text-text-secondary">{item.a}</p>
        </div>
      </div>
    </div>
  );
}
