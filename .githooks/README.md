# .githooks - guardrail Git DASHBOARD CS (FU-3)

Hook **sottrattivi**: BLOCCANO azioni rischiose, **non** automatizzano lavoro.
Attivazione (locale, da rifare su ogni clone): `git config core.hooksPath .githooks`

## pre-commit blocca
- staging vuoto;
- commit troppo largo (> 25 file) salvo `DASHBOARD_ALLOW_WIDE_COMMIT=1`;
- file `.env` in staging;
- possibile secret/token nel diff staged (il valore NON viene stampato);
- ambiente non sano: `origin/HEAD` != `refs/remotes/origin/main`.

## pre-push blocca
- **push diretto su `main`** salvo `DASHBOARD_ALLOW_MAIN_PUSH=1` — ⚠️ **ogni push su `main` fa DEPLOY Railway**;
- push su `main` quando il locale e' **indietro/divergente** vs `origin/main` (NON aggirabile dall'override);
- qualsiasi push se `origin/HEAD` != `refs/remotes/origin/main`.
- I push su branch dedicati sono consentiti.

## Override (usare con criterio)
- `DASHBOARD_ALLOW_WIDE_COMMIT=1 git commit ...`
- `DASHBOARD_ALLOW_MAIN_PUSH=1 git push ...` (solo fast-forward; **fa deploy Railway**)
- Eccezione estrema su un singolo commit: `git commit --no-verify`

## Checker
`python tools/safe_git_close_session.py --self-test` (logica pura) ;
`python tools/safe_git_close_session.py --repo <path> --files <...> [--push --push-target main]` -> verdetto SICURO/NON SICURO (read-only). Riconosce il repo dal remote (`dashboard-cs` -> `main`).

## Nota deploy Railway
`main` e' il branch di deploy: ogni push lo ricostruisce/deploya. Lavora su branch dedicato e porta su `main` solo cambi verificati. Vedi `GIT_SESSION_PLAYBOOK.md`.
