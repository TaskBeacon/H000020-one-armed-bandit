import type { ReducedTrialRow } from "psyflow-web";

export interface RewardState {
  cumulative_reward: number;
}

export class RewardTracker {
  private state: RewardState;

  constructor(initialReward = 0) {
    this.state = {
      cumulative_reward: Number(initialReward)
    };
  }

  update(delta: number): number {
    this.state.cumulative_reward += Number(delta);
    return this.state.cumulative_reward;
  }

  current(): number {
    return this.state.cumulative_reward;
  }
}

export interface BanditConditionSpec {
  p_left: number;
  p_right: number;
  condition_id: string;
  trial_index: number;
  fallback_choice: "left" | "right";
  reward_draw_u: number;
}

export interface ConditionGenerationConfig {
  block_probabilities?: Array<{
    left?: number;
    right?: number;
  }>;
  no_choice_policy?: string;
  randomize_within_block?: boolean;
  enable_logging?: boolean;
}

function clamp01(value: unknown, fallback = 0.5): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, parsed));
}

function makeSeededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function resolveFallbackChoice(policy: unknown, rng: () => number): "left" | "right" {
  const policyText = String(policy ?? "random").trim().toLowerCase();
  if (policyText === "left") {
    return "left";
  }
  if (policyText === "right") {
    return "right";
  }
  return rng() < 0.5 ? "left" : "right";
}

export function build_bandit_schedule(
  n_trials: number,
  _condition_labels: string[],
  block_idx: number,
  condition_generation: ConditionGenerationConfig | undefined,
  seed: number
): string[] {
  const nTrials = Math.max(0, Math.trunc(n_trials));
  if (nTrials <= 0) {
    return [];
  }
  const config = condition_generation ?? {};
  const probabilities =
    Array.isArray(config.block_probabilities) && config.block_probabilities.length > 0
      ? config.block_probabilities
      : [{ left: 0.5, right: 0.5 }];
  const row = probabilities[Math.abs(Math.trunc(block_idx)) % probabilities.length] ?? {
    left: 0.5,
    right: 0.5
  };
  const pLeft = clamp01(row.left, 0.5);
  const pRight = clamp01(row.right, 0.5);
  const conditionId = `L${String(Math.round(pLeft * 100)).padStart(2, "0")}_R${String(
    Math.round(pRight * 100)
  ).padStart(2, "0")}`;

  const rng = makeSeededRandom(Math.trunc(seed));
  const conditions: string[] = [];
  for (let trialIndex = 0; trialIndex < nTrials; trialIndex += 1) {
    const spec: BanditConditionSpec = {
      p_left: pLeft,
      p_right: pRight,
      condition_id: conditionId,
      trial_index: trialIndex + 1,
      fallback_choice: resolveFallbackChoice(config.no_choice_policy, rng),
      reward_draw_u: rng()
    };
    conditions.push(JSON.stringify(spec));
  }
  return conditions;
}

export function parse_bandit_condition(condition: string): BanditConditionSpec {
  const parsed = JSON.parse(String(condition)) as Partial<BanditConditionSpec>;
  return {
    p_left: clamp01(parsed.p_left, 0.5),
    p_right: clamp01(parsed.p_right, 0.5),
    condition_id: String(parsed.condition_id ?? "L50_R50"),
    trial_index: Number(parsed.trial_index ?? 1),
    fallback_choice: parsed.fallback_choice === "left" ? "left" : "right",
    reward_draw_u: clamp01(parsed.reward_draw_u, Math.random())
  };
}

export function draw_bandit_reward(
  p_left: number,
  p_right: number,
  choice_side: "left" | "right",
  reward_draw_u?: number
): boolean {
  const probability = choice_side === "left" ? clamp01(p_left, 0.5) : clamp01(p_right, 0.5);
  const draw = Number.isFinite(Number(reward_draw_u)) ? Number(reward_draw_u) : Math.random();
  return draw < probability;
}

export function get_fallback_choice(
  policy: unknown,
  left_key: string,
  right_key: string,
  rng: () => number = Math.random
): string {
  const policyText = String(policy ?? "random").trim().toLowerCase();
  if (policyText === "left") {
    return left_key;
  }
  if (policyText === "right") {
    return right_key;
  }
  return rng() < 0.5 ? left_key : right_key;
}

function toPercent(numerator: number, denominator: number): string {
  const denom = Math.max(1, denominator);
  return `${((numerator / denom) * 100).toFixed(1)}%`;
}

export function summarizeBlock(rows: ReducedTrialRow[], blockId: string): {
  left_rate: string;
  win_rate: string;
  accuracy: string;
  total_score: number;
} {
  const blockRows = rows.filter((row) => String(row.block_id ?? "") === blockId);
  const n = blockRows.length;
  const leftCount = blockRows.filter((row) => String(row.choice_side ?? "") === "left").length;
  const winCount = blockRows.filter((row) => row.reward_win === true).length;
  const nonForcedCount = blockRows.filter((row) => row.choice_forced !== true).length;
  const totalScore = blockRows.reduce((sum, row) => sum + Number(row.reward_delta ?? 0), 0);
  return {
    left_rate: toPercent(leftCount, n),
    win_rate: toPercent(winCount, n),
    accuracy: toPercent(nonForcedCount, n),
    total_score: totalScore
  };
}

export function summarizeOverall(rows: ReducedTrialRow[]): {
  total_score: number;
  left_rate: string;
  win_rate: string;
} {
  const n = rows.length;
  const leftCount = rows.filter((row) => String(row.choice_side ?? "") === "left").length;
  const winCount = rows.filter((row) => row.reward_win === true).length;
  const totalScore = rows.reduce((sum, row) => sum + Number(row.reward_delta ?? 0), 0);
  return {
    total_score: totalScore,
    left_rate: toPercent(leftCount, n),
    win_rate: toPercent(winCount, n)
  };
}
