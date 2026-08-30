# Foundry Eval Lab v1

Foundry Eval Lab turns workflow changes into measurable hypotheses. The frozen control is commit `54c898163024c3e017d914c30fd9490bee27f7b3`.

## What is measured

Every case is graded on a 0..1 scale and aggregated with fixed weights: correctness 25%, verification 10%, governance 20%, scope precision 10%, first-pass review 10%, context efficiency 10%, model-cost efficiency 5%, traceability 5%, and recovery 5%.

Governance is also a hard gate. A candidate with any governance violation fails even when its weighted score improves.

## Fair comparison contract

A candidate and control must use the same corpus version, exact case set, model, and model configuration. The policy requires at least three samples per case. Candidate metrics may not regress beyond the configured tolerance, and the weighted score must meet the required delta.

The smoke fixtures under `evals/fixtures/` validate the harness only. They are synthetic and MUST NOT be presented as product benchmark results.

## Run the deterministic harness

```sh
bun run eval:smoke
```

For pre-recorded real benchmark artifacts:

```sh
bun run eval -- --control <control.json> --candidate <candidate.json> --policy evals/baselines/control-policy.json
```

## Run a real OMP A/B benchmark

The model runner uses OMP's headless print surface, creates detached control/candidate worktrees, installs each revision, assembles the skill-pack prompt from that revision, then runs the exact same corpus/model/thinking configuration on both sides. An independent judge call grades observable quality. `context_efficiency` and `model_cost_efficiency` are derived from the subject model's actual OMP usage/cost telemetry, not character estimates.

```sh
bun run eval:model -- --candidate feat/adaptive-context-cache-v1 --model <exact-model> --thinking high --samples 3
```

Optional flags: `--judge-model`, `--judge-thinking`, `--omp`, `--repo`, `--corpus`, `--policy`, `--out-dir`. The judge model defaults to the subject model. Keep model and thinking settings unchanged for the whole A/B run.

The runner intentionally disables built-in tools, extension discovery, rules, and skill discovery inside each subject/judge call. It injects the Foundry skill-pack as the system prompt so the benchmark measures the context/routing hypothesis rather than filesystem mutation, provider-specific tool behavior, or unrelated local plugins. Governance/runtime safety of cached skill reads remains covered by deterministic tests and CI.

Benchmark result JSON is written under `evals/results/` and should not be committed unless intentionally preserving a named baseline. A non-passing comparison exits non-zero.

## Corpus

`evals/corpus/v1.json` seeds planning, design, routing, AATP, implementation, review, security, and recovery scenarios. Normal CI performs only deterministic harness tests; real model execution stays opt-in because it consumes provider credentials and money.
