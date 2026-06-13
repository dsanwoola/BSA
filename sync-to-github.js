#!/usr/bin/env node
/* =========================================================================
 * AUTO-SYNC TO GITHUB
 * -------------------------------------------------------------------------
 * Commits any local changes and pushes them to the GitHub remote.
 * Invoked automatically by a Claude Code hook (see .claude/settings.local.json),
 * and runnable by hand any time:  node sync-to-github.js
 *
 * Safe by design:
 *   - operates on its OWN directory, wherever it is checked out;
 *   - does nothing when there are no changes (no empty commits);
 *   - .gitignore keeps real bank statements / fixtures out of the push;
 *   - never throws: a failure (e.g. offline, not yet authenticated) is
 *     reported but never blocks your Claude Code session.
 * ========================================================================= */
"use strict";

var execSync = require("child_process").execSync;
var repo = __dirname;

function git(args, opts) {
  return execSync("git " + args, Object.assign({ cwd: repo, stdio: "pipe" }, opts || {}))
    .toString().trim();
}

try {
  // inside a git repo?
  try { git("rev-parse --is-inside-work-tree"); }
  catch (e) { console.log("[sync] not a git repository — skipped."); process.exit(0); }

  // anything to sync?
  var dirty = git("status --porcelain");
  if (dirty) {
    var stamp = new Date().toISOString().replace("T", " ").slice(0, 16);
    git("add -A");
    // commit message via a temp-free heredoc-equivalent: pass with -m
    execSync('git commit -q -m "Auto-sync ' + stamp + '"', { cwd: repo, stdio: "pipe" });
    console.log("[sync] committed local changes (" + stamp + ").");
  } else {
    console.log("[sync] working tree clean.");
  }

  // is there a remote to push to?
  var hasRemote = "";
  try { hasRemote = git("remote"); } catch (e) { /* none */ }
  if (!hasRemote) { console.log("[sync] no remote configured — commit kept locally."); process.exit(0); }

  // are we ahead of the remote (or is the branch new)?
  var branch = git("rev-parse --abbrev-ref HEAD");
  try {
    git("push -u origin " + branch);
    console.log("[sync] pushed '" + branch + "' to origin. ✓");
  } catch (e) {
    var msg = (e.stderr ? e.stderr.toString() : "") || e.message || "";
    if (/Authentication|could not read Username|terminal prompts disabled|403|fatal: could not/i.test(msg)) {
      console.log("[sync] commit saved locally, but PUSH needs GitHub auth.");
      console.log("[sync] run once in your terminal:  gh auth login");
    } else {
      console.log("[sync] push failed: " + msg.split("\n")[0]);
    }
  }
} catch (err) {
  // never let sync break the session
  console.log("[sync] skipped: " + (err.message || String(err)).split("\n")[0]);
}
process.exit(0);
