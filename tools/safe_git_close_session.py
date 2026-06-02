#!/usr/bin/env python3
"""
safe_git_close_session.py - Checker READ-ONLY per la chiusura sessione Git DASHBOARD CS.

Valida che una chiusura (staging / commit / push) rispetti la disciplina del
GIT_SESSION_PLAYBOOK.md. NON muta git: niente add/commit/push/reset/restore/clean/stash.

Repo-aware: riconosce dashboard-cs -> main (override push DASHBOARD_ALLOW_MAIN_PUSH)
e osseotouch -> master (override push OSSEO_ALLOW_MASTER_PUSH).

Exit code: 0 = SICURO, 1 = NON SICURO.

Uso:
  python tools/safe_git_close_session.py --self-test
  python tools/safe_git_close_session.py --repo . --files PATH [PATH ...]
  python tools/safe_git_close_session.py --repo . --files PATH --push --push-target main

ATTENZIONE: su DASHBOARD CS ogni push su 'main' fa DEPLOY Railway.
Vedi: GIT_SESSION_PLAYBOOK.md
"""
from __future__ import annotations
import argparse
import os
import subprocess
import sys

# Top-level operativi (rilevante per OSSEOTOUCH AI; su DASHBOARD CS resta inerte).
OPERATIVE = {
    "ANTONIA", "COLTRI", "FREELANCER", "JAN34", "JESFAG", "KESSEL",
    "MYOSSEOTOUCH", "SalesForceFree", "SUTURE", "TRAINER",
    "analisi_finanziaria", "analisi_vendite", "cereda", "Elfy",
}
MAX_FILES = 25

OK, WARN, FAIL = "OK", "WARN", "FAIL"


def git(args, repo="."):
    """Comando git READ-ONLY -> (rc, stdout, stderr)."""
    try:
        r = subprocess.run(["git", "-C", repo] + args, capture_output=True, text=True)
        return r.returncode, r.stdout.strip(), r.stderr.strip()
    except FileNotFoundError:
        return 127, "", "git non trovato"


# --------------------------- funzioni PURE (testabili) ---------------------------

def operative_dirs(files):
    """Insieme dei top-level operativi toccati dai file."""
    dirs = set()
    for f in files:
        f = (f or "").strip().strip('"')
        if not f:
            continue
        top = f.replace("\\", "/").split("/")[0]
        if top in OPERATIVE:
            dirs.add(top)
    return dirs


def is_cross_agent(files):
    return len(operative_dirs(files)) > 1


def is_too_wide(files, allow_wide=False):
    n = len([f for f in files if (f or "").strip()])
    return (not allow_wide) and n > MAX_FILES


def repo_kind(remote_url):
    """('osseotouch','master') | ('dashboard-cs','main') | ('unknown', None)"""
    u = (remote_url or "").lower()
    if "osseotouch-ai" in u:
        return ("osseotouch", "master")
    if "dashboard-cs" in u:
        return ("dashboard-cs", "main")
    return ("unknown", None)


def push_override_var(kind):
    """Variabile env di override del push base, per repo."""
    return "DASHBOARD_ALLOW_MAIN_PUSH" if kind == "dashboard-cs" else "OSSEO_ALLOW_MASTER_PUSH"


def wide_override_var(kind):
    """Variabile env di override del commit largo, per repo."""
    return "DASHBOARD_ALLOW_WIDE_COMMIT" if kind == "dashboard-cs" else "OSSEO_ALLOW_WIDE_COMMIT"


# --------------------------- check basati su git (read-only) ---------------------------

def run_checks(repo, expected_files, intend_push, push_target):
    results = []  # (level, label, msg)

    rc, url, _ = git(["remote", "get-url", "origin"], repo)
    kind, exp_branch = repo_kind(url if rc == 0 else "")
    if kind == "unknown":
        results.append((WARN, "repo", f"remote non riconosciuto: {url or 'n/d'}"))
    else:
        results.append((OK, "repo", f"{kind} -> branch base atteso '{exp_branch}'"))

    _, branch, _ = git(["branch", "--show-current"], repo)
    if exp_branch and branch == exp_branch:
        results.append((WARN, "branch", f"sei sul branch base '{branch}': la chiusura dovrebbe avvenire da branch/worktree dedicato"))
    else:
        results.append((OK, "branch", f"branch dedicato '{branch or '(detached)'}'"))

    if exp_branch:
        _, oh, _ = git(["symbolic-ref", "refs/remotes/origin/HEAD"], repo)
        want = f"refs/remotes/origin/{exp_branch}"
        if oh == want:
            results.append((OK, "origin/HEAD", oh))
        else:
            results.append((FAIL, "origin/HEAD", f"e' '{oh or 'non impostato'}', atteso '{want}'  (fix: git remote set-head origin {exp_branch})"))

    _, hp, _ = git(["config", "--get", "core.hooksPath"], repo)
    if hp == ".githooks":
        results.append((OK, "core.hooksPath", hp))
    else:
        results.append((WARN, "core.hooksPath", f"e' '{hp or 'non impostato'}', atteso '.githooks' (guardrail non attivi; fix: git config core.hooksPath .githooks)"))

    # path ASSOLUTO del git common dir del repo passato con --repo (fix FU-4: evita
    # di risolvere un path relativo rispetto alla cwd sbagliata in scenari cross-repo).
    rc_cd, common, _ = git(["rev-parse", "--path-format=absolute", "--git-common-dir"], repo)
    if rc_cd != 0 or not common:
        _, common_rel, _ = git(["rev-parse", "--git-common-dir"], repo)
        if common_rel:
            common = common_rel if os.path.isabs(common_rel) else os.path.join(repo, common_rel)
        else:
            common = os.path.join(repo, ".git")
    pc = os.path.join(common, "hooks", "post-commit")
    if os.path.isfile(pc):
        try:
            content = open(pc, "r", encoding="utf-8", errors="replace").read()
        except OSError:
            content = ""
        if "CEREDA_SYNC" in content:
            results.append((OK, "cereda-gate", "post-commit contiene il gate CEREDA_SYNC"))
        else:
            results.append((FAIL, "cereda-gate", "post-commit esiste ma NON contiene il gate CEREDA_SYNC (forma pericolosa)"))
    else:
        results.append((OK, "cereda-gate", "nessun post-commit attivo (ok)"))

    _, staged_raw, _ = git(["-c", "core.quotepath=false", "diff", "--cached", "--name-only"], repo)
    staged = [l for l in staged_raw.splitlines() if l.strip()]

    if expected_files is not None:
        exp = sorted(set(expected_files))
        act = sorted(set(staged))
        if act == exp:
            results.append((OK, "staged", f"{len(act)} file == attesi"))
        else:
            extra = sorted(set(act) - set(exp))
            missing = sorted(set(exp) - set(act))
            parts = []
            if extra:
                parts.append(f"EXTRA non attesi: {extra}")
            if missing:
                parts.append(f"MANCANTI: {missing}")
            results.append((FAIL, "staged", "; ".join(parts) or "mismatch"))
    else:
        results.append((WARN, "staged", f"{len(staged)} file staged (nessuna lista --files fornita)"))

    check_files = staged
    od = operative_dirs(check_files)
    if is_cross_agent(check_files):
        results.append((FAIL, "cross-agente", f"lo staging tocca piu' agenti: {sorted(od)}"))
    else:
        results.append((OK, "cross-agente", f"agenti toccati: {sorted(od) or 'nessuno (root/non-operativo)'}"))

    allow_wide = os.environ.get(wide_override_var(kind)) == "1"
    n = len(check_files)
    if is_too_wide(check_files, allow_wide):
        results.append((FAIL, "commit-largo", f"{n} file > {MAX_FILES} (override: {wide_override_var(kind)}=1)"))
    else:
        suffix = " (override attivo)" if (allow_wide and n > MAX_FILES) else ""
        results.append((OK, "commit-largo", f"{n} file <= {MAX_FILES}{suffix}"))

    if intend_push:
        target = push_target or exp_branch or "main"
        if target in ("master", "main"):
            _, behind, _ = git(["rev-list", "--count", f"HEAD..origin/{target}"], repo)
            try:
                behind_n = int(behind)
            except ValueError:
                behind_n = -1
            ovar = push_override_var(kind)
            allow_push = os.environ.get(ovar) == "1"
            if behind_n != 0:
                results.append((FAIL, "push", f"push verso '{target}' ma behind/divergente di {behind} (serve fast-forward)"))
            elif not allow_push:
                results.append((FAIL, "push", f"push diretto su '{target}' senza {ovar}=1"))
            else:
                results.append((OK, "push", f"push verso '{target}': fast-forward + override ({ovar}) -> consentito"))
        else:
            results.append((OK, "push", f"push verso branch non-base '{target}' (consentito)"))

    return results


# --------------------------- self-test (pure, no git) ---------------------------

def self_test():
    tests = []

    def chk(name, cond):
        tests.append((name, bool(cond)))

    chk("cross-agent: 2 agenti -> True", is_cross_agent(["JESFAG/a.py", "KESSEL/b.sql"]) is True)
    chk("cross-agent: 1 agente -> False", is_cross_agent(["JESFAG/a.py", "JESFAG/b.py"]) is False)
    chk("cross-agent: root/non-op -> False", is_cross_agent(["README.md", ".githooks/x", "tools/y.py"]) is False)
    chk("too-wide: 26 -> True", is_too_wide([f"f{i}" for i in range(26)]) is True)
    chk("too-wide: 25 -> False", is_too_wide([f"f{i}" for i in range(25)]) is False)
    chk("too-wide: override -> False", is_too_wide([f"f{i}" for i in range(99)], allow_wide=True) is False)
    chk("repo osseotouch", repo_kind("https://github.com/claydegi/OSSEOTOUCH-AI.git") == ("osseotouch", "master"))
    chk("repo dashboard", repo_kind("git@github.com:claydegi/dashboard-cs.git") == ("dashboard-cs", "main"))
    chk("repo unknown", repo_kind("https://example.com/foo.git") == ("unknown", None))
    chk("override dashboard", push_override_var("dashboard-cs") == "DASHBOARD_ALLOW_MAIN_PUSH")
    chk("override osseotouch", push_override_var("osseotouch") == "OSSEO_ALLOW_MASTER_PUSH")
    chk("wide-override dashboard", wide_override_var("dashboard-cs") == "DASHBOARD_ALLOW_WIDE_COMMIT")
    chk("backslash path", operative_dirs(["JESFAG\\scripts\\a.py"]) == {"JESFAG"})

    passed = sum(1 for _, ok in tests if ok)
    for name, ok in tests:
        print(f"  [{'PASS' if ok else 'FAIL'}] {name}")
    print(f"self-test: {passed}/{len(tests)} passati")
    return passed == len(tests)


def main():
    ap = argparse.ArgumentParser(
        description="Checker read-only chiusura sessione Git DASHBOARD CS (vedi GIT_SESSION_PLAYBOOK.md)."
    )
    ap.add_argument("--repo", default=".", help="path del repo (default: .)")
    ap.add_argument("--files", nargs="*", default=None, help="file attesi nello staging")
    ap.add_argument("--push", action="store_true", help="valida anche la sicurezza del push")
    ap.add_argument("--push-target", default=None, choices=["master", "main"], help="branch remoto target del push")
    ap.add_argument("--self-test", action="store_true", help="esegue i test della logica pura (no git) ed esce")
    args = ap.parse_args()

    if args.self_test:
        sys.exit(0 if self_test() else 1)

    results = run_checks(args.repo, args.files, args.push, args.push_target)
    print("=== safe_git_close_session - checker (read-only) ===")
    n_fail = sum(1 for level, _, _ in results if level == FAIL)
    for level, label, msg in results:
        print(f"  [{level:4}] {label}: {msg}")
    print(f"--- VERDETTO: {'SICURO' if n_fail == 0 else 'NON SICURO'} ({n_fail} blocchi) ---")
    sys.exit(0 if n_fail == 0 else 1)


if __name__ == "__main__":
    main()
