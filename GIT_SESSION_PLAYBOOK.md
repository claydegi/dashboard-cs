# GIT_SESSION_PLAYBOOK — DASHBOARD CS

> Procedura Git di chiusura sessione per **DASHBOARD CS** (repo `claydegi/dashboard-cs`, branch base **`main`**).
> Allineata alla disciplina di OSSEOTOUCH AI (vedi `GIT_SESSION_PLAYBOOK.md` di quel repo). Introdotta con FU-3.

## ⚠️ Attenzione deploy
**Ogni push su `main` fa DEPLOY su Railway.** Lavora sempre su branch/worktree dedicato; porta su `main` solo cambi verificati.

## Principi
1. **Isolamento**: ogni sessione su branch/worktree dedicato da `origin/main`. `main` = base di integrazione + deploy, non tavolo di lavoro.
2. **Staging chirurgico**: solo file espliciti. Mai `git add .` / `git add -A`.
3. **Freni**: guardrail `.githooks/` (pre-commit, pre-push) + checker `tools/safe_git_close_session.py`.
4. **Reversibilita'**: vietati `reset --hard`, `clean`, `stash`, `push --force`.
5. **Push su `main` solo fast-forward + `DASHBOARD_ALLOW_MAIN_PUSH=1`**.

## Setup one-time (ogni clone)
```bash
git config core.hooksPath .githooks     # attiva i guardrail (config LOCALE)
git remote set-head origin main          # origin/HEAD -> main
```

## Chiusura sessione
1. `git fetch origin`
2. `git worktree add -b codex/<task> /c/tmp/dashboard-cs-<task> origin/main`
3. modifica/copia SOLO i file in scope nel worktree (NON server.js/public/package.json se non e' il task)
4. `git -C <wt> add <file espliciti>` ; `git -C <wt> diff --cached --name-only` (== scope)
5. checker: `python tools/safe_git_close_session.py --repo <wt> --files <...> --push --push-target main`
6. `git -C <wt> commit -m "<cosa>"`
7. `git fetch origin` ; se `git -C <wt> rev-list --count HEAD..origin/main` > 0 -> **STOP** (non fast-forward)
8. `DASHBOARD_ALLOW_MAIN_PUSH=1 git -C <wt> push origin codex/<task>:main`  (-> DEPLOY Railway)
9. allinea main: `git -C "<DASHBOARD CS>" merge --ff-only origin/main`
10. cleanup: `git worktree remove <wt>` + `git branch -d codex/<task>` (solo se clean + integrato)

## Checker
```bash
python tools/safe_git_close_session.py --self-test
python tools/safe_git_close_session.py --repo . --files <...> [--push --push-target main]
```
Exit 0 = SICURO, 1 = NON SICURO. Read-only. Riconosce il repo dal remote (`dashboard-cs` -> `main`) e usa l'override `DASHBOARD_ALLOW_MAIN_PUSH` per il push su main.

## Task chiuso quando
- commit fatto; push fatto; `HEAD == origin/main`; working tree pulito;
- se il push tocca codice app: deploy Railway verificato (build OK, servizio up).
