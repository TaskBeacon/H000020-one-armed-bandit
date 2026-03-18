# H000020 One-Armed Bandit

HTML/browser preview of the One-Armed Bandit task built with `psyflow-web`.
Trial procedure, side-choice semantics, timeout fallback, reward sampling, and score accumulation are aligned to local `T000020-one-armed-bandit`, with shorter block/trial counts for preview.

## Layout

- `main.ts`: task orchestration
- `config/config.yaml`: declarative config
- `src/run_trial.ts`: trial logic
- `src/utils.ts`: condition generation, reward helpers, and summary helpers

## Run

From `e:\xhmhc\TaskBeacon\psyflow-web`:

```powershell
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:4173/?task=H000020-one-armed-bandit
```
