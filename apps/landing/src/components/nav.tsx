import { Github } from "lucide-react";
import { BnotMark } from "./bnot-mark";

export function Nav() {
  return (
    <nav className="px-6 py-5 flex items-center justify-between max-w-7xl mx-auto">
      <BnotMark hoverAnim />

      <div className="hidden md:flex items-center gap-10">
        <a
          href="#features"
          className="text-sm font-medium text-text-muted hover:text-text-primary transition-colors"
        >
          Features
        </a>
        <a
          href="#faq"
          className="text-sm font-medium text-text-muted hover:text-text-primary transition-colors"
        >
          FAQ
        </a>
      </div>

      <div className="flex items-center gap-3">
        <a
          href="https://github.com/ababol/bnot"
          target="_blank"
          rel="noreferrer"
          className="hidden sm:inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary transition-colors"
        >
          <Github className="w-4 h-4" />
          <span className="hidden md:inline">Star</span>
        </a>
        <a
          href="https://github.com/ababol/bnot/releases/latest/download/Bnot-universal.dmg"
          className="btn-glass"
        >
          Download
        </a>
      </div>
    </nav>
  );
}
