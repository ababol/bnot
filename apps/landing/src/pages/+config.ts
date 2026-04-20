import vikeReact from "vike-react/config";
import type { Config } from "vike/types";

export default {
  extends: vikeReact,
  prerender: true,
  lang: "en",
  title: "Bnot: Claude Code, live in your notch.",
  description:
    "Bnot: Claude Code, live in your notch. Every session, every worktree. One glance, one keystroke away.",
} satisfies Config;
