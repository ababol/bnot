(function () {
  "use strict";

  const BTN_CLASS = "bnot-worktree-btn";

  function getPRMetadata() {
    const urlMatch = location.pathname.match(/\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!urlMatch) return null;

    const [, owner, repo] = urlMatch;

    // Find any head branch link to extract metadata
    const branchLinks = document.querySelectorAll('a[class*="BranchName"][href*="/tree/"]');

    // Head branch links are inside a div with a copy button sibling
    for (const link of branchLinks) {
      const container = link.closest("div");
      if (!container) continue;
      // The head branch container has a copy button
      if (!container.querySelector('[class*="CopyToClipboard"], button[aria-labelledby]')) continue;

      const href = link.getAttribute("href") || "";
      const hrefMatch = href.match(/\/([^/]+)\/([^/]+)\/tree\/(.+)/);
      if (!hrefMatch) continue;

      return {
        owner,
        repo,
        headOwner: hrefMatch[1],
        headRepo: hrefMatch[2],
        branch: hrefMatch[3],
      };
    }

    return null;
  }

  function createButton(meta) {
    const btn = document.createElement("button");
    btn.className = BTN_CLASS;
    btn.title = "Open in Bnot worktree";
    btn.setAttribute("aria-label", "Open in Bnot worktree");

    Object.assign(btn.style, {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "4px",
      marginLeft: "4px",
      border: "1px solid var(--borderColor-default, #d1d5db)",
      borderRadius: "6px",
      background: "var(--bgColor-default, transparent)",
      cursor: "pointer",
      verticalAlign: "middle",
      color: "var(--fgColor-muted, #656d76)",
      lineHeight: "1",
    });

    // Bnot pixel-art character (matches Bnot tray icon)
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="2" width="3" height="2" rx="0.5" fill="#4ade80"/>
      <rect x="10" y="2" width="3" height="2" rx="0.5" fill="#4ade80"/>
      <rect x="3" y="4" width="10" height="8" rx="1" fill="#4ade80"/>
      <rect x="3" y="12" width="4" height="2" rx="0.5" fill="#4ade80"/>
      <rect x="9" y="12" width="4" height="2" rx="0.5" fill="#4ade80"/>
      <rect x="5" y="6" width="2" height="2" rx="0.5" fill="#1a1a2e"/>
      <rect x="9" y="6" width="2" height="2" rx="0.5" fill="#1a1a2e"/>
    </svg>`;

    btn.addEventListener("mouseenter", () => {
      btn.style.color = "var(--fgColor-default, #1f2328)";
      btn.style.borderColor = "var(--borderColor-emphasis, #636c76)";
    });

    btn.addEventListener("mouseleave", () => {
      btn.style.color = "var(--fgColor-muted, #656d76)";
      btn.style.borderColor = "var(--borderColor-default, #d1d5db)";
    });

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      const params = new URLSearchParams({
        owner: meta.owner,
        repo: meta.repo,
        branch: meta.branch,
        headOwner: meta.headOwner,
        headRepo: meta.headRepo,
      });

      window.location.href = `bnot://worktree?${params.toString()}`;
    });

    return btn;
  }

  function injectButtons() {
    const meta = getPRMetadata();
    if (!meta) return;

    // Find all head branch containers (the ones with the copy button)
    const branchLinks = document.querySelectorAll('a[class*="BranchName"][href*="/tree/"]');

    for (const link of branchLinks) {
      // Head branch link's direct parent is a div; base branch is inside a span
      const parent = link.parentElement;
      if (!parent || parent.tagName !== "DIV") continue;

      // Skip if already injected
      if (parent.querySelector("." + BTN_CLASS)) continue;

      const btn = createButton(meta);
      parent.appendChild(btn);
    }
  }

  injectButtons();

  let debounceTimer;
  const observer = new MutationObserver(() => {
    if (!location.pathname.match(/\/[^/]+\/[^/]+\/pull\/\d+/)) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(injectButtons, 500);
  });

  observer.observe(document.body, { childList: true, subtree: true });

  document.addEventListener("turbo:load", () => {
    if (location.pathname.match(/\/[^/]+\/[^/]+\/pull\/\d+/)) {
      setTimeout(injectButtons, 300);
    }
  });
})();
