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

For a real benchmark, produce one control run JSON and one candidate run JSON using the schema represented by the smoke fixtures, then run:

```sh
bun run eval -- --control <control.json> --candidate <candidate.json> --policy evals/baselines/control-policy.json
```

The command exits non-zero for invalid artifacts, fairness mismatches, governance violations, metric regressions, or insufficient weighted-score improvement.

## Corpus

`evals/corpus/v1.json` seeds planning, design, routing, AATP, implementation, review, security, and recovery scenarios. Model execution is intentionally not performed inside normal CI: CI must stay deterministic and must not fabricate benchmark scores or depend on provider credentials.
