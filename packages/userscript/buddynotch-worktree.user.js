// ==UserScript==
// @name         BuddyNotch - Open in Worktree
// @namespace    com.buddynotch
// @version      1.0.0
// @description  Adds "Open in worktree" button to GitHub PR pages
// @match        https://github.com/*/pull/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const BUTTON_ID = "buddynotch-worktree-btn";

  function getPRMetadata() {
    // Base owner/repo from the URL: /owner/repo/pull/123
    const urlMatch = location.pathname.match(/\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!urlMatch) return null;

    const [, owner, repo] = urlMatch;

    // Head branch: find the last branch-name link with /tree/ in its href.
    // GitHub's PR header has two branch refs: base (into) and head (from).
    // The head branch link contains /tree/<branch> and lives after the "from" text.
    const branchLinks = document.querySelectorAll('a[class*="BranchName"][href*="/tree/"]');

    // The last matching link is the head branch
    const headLink = branchLinks[branchLinks.length - 1];
    if (!headLink) return null;

    const href = headLink.getAttribute("href") || "";
    // href: /headOwner/headRepo/tree/branch/name/with/slashes
    const hrefMatch = href.match(/\/([^/]+)\/([^/]+)\/tree\/(.+)/);
    if (!hrefMatch) return null;

    return {
      owner,
      repo,
      headOwner: hrefMatch[1],
      headRepo: hrefMatch[2],
      branch: hrefMatch[3],
    };
  }

  function createButton(meta) {
    const btn = document.createElement("button");
    btn.id = BUTTON_ID;
    btn.title = "Open in BuddyNotch worktree";
    btn.setAttribute("aria-label", "Open in BuddyNotch worktree");

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

    // Git worktree icon (folder with branch)
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path fill-rule="evenodd" d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2c-.33-.44-.85-.7-1.4-.7H1.75ZM1.5 2.75a.25.25 0 0 1 .25-.25H5c.092 0 .178.042.243.117l.9 1.2c.328.44.847.683 1.357.683h6.75a.25.25 0 0 1 .25.25v8.5a.25.25 0 0 1-.25.25H1.75a.25.25 0 0 1-.25-.25V2.75Z"/>
      <circle cx="6" cy="9" r="1.25" fill="currentColor" opacity="0.6"/>
      <circle cx="10" cy="7" r="1.25" fill="currentColor" opacity="0.6"/>
      <path d="M6 7.75V9M10 8.25V10.25" stroke="currentColor" stroke-width="1" opacity="0.6"/>
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

      window.location.href = `buddynotch://worktree?${params.toString()}`;
    });

    return btn;
  }

  function injectButton() {
    if (document.getElementById(BUTTON_ID)) return;

    const meta = getPRMetadata();
    if (!meta) return;

    // Find the head branch area. Look for the last BranchName link,
    // then insert our button next to its parent container
    // (which includes the copy-to-clipboard button).
    const branchLinks = document.querySelectorAll('a[class*="BranchName"][href*="/tree/"]');
    const headLink = branchLinks[branchLinks.length - 1];
    if (!headLink) return;

    // Walk up to find the container that holds both the branch link and copy button
    const container = headLink.closest("div") || headLink.parentElement;
    if (!container) return;

    const btn = createButton(meta);
    container.appendChild(btn);
  }

  // Initial injection
  injectButton();

  // Re-inject on GitHub SPA navigation (Turbo)
  let debounceTimer;
  const observer = new MutationObserver(() => {
    if (!location.pathname.match(/\/[^/]+\/[^/]+\/pull\/\d+/)) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(injectButton, 500);
  });

  observer.observe(document.body, { childList: true, subtree: true });

  document.addEventListener("turbo:load", () => {
    if (location.pathname.match(/\/[^/]+\/[^/]+\/pull\/\d+/)) {
      setTimeout(injectButton, 300);
    }
  });
})();
