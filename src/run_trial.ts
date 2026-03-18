import {
  set_trial_context,
  type StimBank,
  type TaskSettings,
  type TrialBuilder,
  type TrialSnapshot
} from "psyflow-web";

import {
  draw_bandit_reward,
  get_fallback_choice,
  parse_bandit_condition,
  type RewardTracker
} from "./utils";

type ChoiceSide = "left" | "right";

function getChoiceSideFromKey(choiceKey: string, leftKey: string): ChoiceSide {
  return choiceKey === leftKey ? "left" : "right";
}

function getStimText(stimBank: StimBank, stimKey: string, fallback: string): string {
  try {
    const spec = stimBank.resolve(stimKey);
    if ("text" in spec && typeof spec.text === "string") {
      return spec.text;
    }
  } catch {
    // fallback text below
  }
  return fallback;
}

function resolveChoiceKey(
  response: unknown,
  fallbackPolicy: unknown,
  leftKey: string,
  rightKey: string
): string {
  if (response === leftKey || response === rightKey) {
    return String(response);
  }
  return get_fallback_choice(fallbackPolicy, leftKey, rightKey);
}

function resolveRewardWin(snapshot: TrialSnapshot, pLeft: number, pRight: number, rewardDrawU: number): boolean {
  const choiceKey = String(snapshot.units.bandit_choice?.choice_key ?? "");
  const leftKey = String(snapshot.units.bandit_choice?.left_key ?? "f");
  const side = getChoiceSideFromKey(choiceKey, leftKey);
  return draw_bandit_reward(pLeft, pRight, side, rewardDrawU);
}

export function run_trial(
  trial: TrialBuilder,
  condition: string,
  context: {
    settings: TaskSettings;
    stimBank: StimBank;
    rewardTracker: RewardTracker;
    block_id: string;
    block_idx: number;
  }
): TrialBuilder {
  const { settings, stimBank, rewardTracker, block_id, block_idx } = context;
  const spec = parse_bandit_condition(condition);
  const triggerMap = (settings.triggers ?? {}) as Record<string, unknown>;

  const leftKey = String(settings.left_key ?? "f");
  const rightKey = String(settings.right_key ?? "j");
  const rewardWinVal = Number(settings.reward_win ?? 10);
  const rewardLossVal = Number(settings.reward_loss ?? 0);
  const noChoicePolicy = settings.no_choice_policy;

  const leftChoiceLabel = getStimText(stimBank, "machine_left_label", "Left Machine");
  const rightChoiceLabel = getStimText(stimBank, "machine_right_label", "Right Machine");

  const preChoiceDuration = Number(settings.pre_choice_fixation_duration ?? 0.5);
  const choiceDuration = Number(settings.bandit_choice_duration ?? 2.5);
  const confirmationDuration = Number(settings.choice_confirmation_duration ?? 0.4);
  const feedbackDuration = Number(settings.outcome_feedback_duration ?? 0.8);
  const itiDuration = Number(settings.iti_duration ?? 0.6);

  const preChoiceFixation = trial.unit("pre_choice_fixation").addStim(stimBank.get("fixation"));
  set_trial_context(preChoiceFixation, {
    trial_id: trial.trial_id,
    phase: "pre_choice_fixation",
    deadline_s: preChoiceDuration,
    valid_keys: [],
    block_id,
    condition_id: spec.condition_id,
    task_factors: {
      stage: "pre_choice_fixation",
      p_left: spec.p_left,
      p_right: spec.p_right,
      block_idx
    },
    stim_id: "fixation"
  });
  preChoiceFixation.show({ duration: preChoiceDuration }).to_dict();

  const banditChoice = trial
    .unit("bandit_choice")
    .addStim(stimBank.get("machine_left"))
    .addStim(stimBank.get("machine_right"))
    .addStim(stimBank.get("machine_left_label"))
    .addStim(stimBank.get("machine_right_label"))
    .addStim(
      stimBank.get_and_format("choice_prompt", {
        deadline_s: choiceDuration.toFixed(1)
      })
    );
  set_trial_context(banditChoice, {
    trial_id: trial.trial_id,
    phase: "bandit_choice",
    deadline_s: choiceDuration,
    valid_keys: [leftKey, rightKey],
    block_id,
    condition_id: spec.condition_id,
    task_factors: {
      stage: "bandit_choice",
      p_left: spec.p_left,
      p_right: spec.p_right,
      block_idx
    },
    stim_id: "bandit_choice"
  });
  banditChoice
    .captureResponse({
      keys: [leftKey, rightKey],
      correct_keys: [leftKey, rightKey],
      duration: choiceDuration,
      terminate_on_response: true,
      response_trigger: {
        [leftKey]: Number(triggerMap.bandit_choice_left_press ?? 31),
        [rightKey]: Number(triggerMap.bandit_choice_right_press ?? 32)
      },
      timeout_trigger: Number(triggerMap.bandit_choice_no_response ?? 33)
    })
    .set_state({
      left_key: leftKey,
      right_key: rightKey,
      choice_key: (snapshot: TrialSnapshot) =>
        resolveChoiceKey(snapshot.units.bandit_choice?.response, noChoicePolicy, leftKey, rightKey),
      choice_side: (snapshot: TrialSnapshot) =>
        getChoiceSideFromKey(
          resolveChoiceKey(snapshot.units.bandit_choice?.response, noChoicePolicy, leftKey, rightKey),
          leftKey
        ),
      choice_made: (snapshot: TrialSnapshot) =>
        snapshot.units.bandit_choice?.response === leftKey || snapshot.units.bandit_choice?.response === rightKey,
      choice_forced: (snapshot: TrialSnapshot) =>
        snapshot.units.bandit_choice?.response !== leftKey && snapshot.units.bandit_choice?.response !== rightKey,
      choice_label: (snapshot: TrialSnapshot) =>
        getChoiceSideFromKey(
          resolveChoiceKey(snapshot.units.bandit_choice?.response, noChoicePolicy, leftKey, rightKey),
          leftKey
        ) === "left"
          ? leftChoiceLabel
          : rightChoiceLabel,
      choice_rt: (snapshot: TrialSnapshot) => snapshot.units.bandit_choice?.rt
    })
    .to_dict();

  const choiceConfirmation = trial
    .unit("choice_confirmation")
    .addStim(stimBank.get("machine_left"))
    .addStim(stimBank.get("machine_right"))
    .addStim(stimBank.get("machine_left_label"))
    .addStim(stimBank.get("machine_right_label"))
    .addStim((snapshot: TrialSnapshot) =>
      snapshot.units.bandit_choice?.choice_side === "left"
        ? stimBank.get("highlight_left")
        : stimBank.get("highlight_right")
    )
    .addStim((snapshot: TrialSnapshot) =>
      stimBank.get_and_format("target_prompt", {
        choice_label:
          snapshot.units.bandit_choice?.choice_side === "left" ? leftChoiceLabel : rightChoiceLabel
      })
    );
  set_trial_context(choiceConfirmation, {
    trial_id: trial.trial_id,
    phase: "choice_confirmation",
    deadline_s: confirmationDuration,
    valid_keys: [],
    block_id,
    condition_id: spec.condition_id,
    task_factors: {
      stage: "choice_confirmation",
      block_idx
    },
    stim_id: "selection_confirmation"
  });
  choiceConfirmation.show({ duration: confirmationDuration }).to_dict();

  const outcomeFeedback = trial
    .unit("outcome_feedback")
    .addStim((snapshot: TrialSnapshot) => {
      const rewardWin = resolveRewardWin(snapshot, spec.p_left, spec.p_right, spec.reward_draw_u);
      const rewardDelta = rewardWin ? rewardWinVal : rewardLossVal;
      const totalScore = rewardTracker.current() + rewardDelta;
      return rewardWin
        ? stimBank.get_and_format("feedback_win", {
            reward_delta: rewardDelta,
            total_score: totalScore
          })
        : stimBank.get_and_format("feedback_loss", {
            reward_delta: rewardDelta,
            total_score: totalScore
          });
    });
  set_trial_context(outcomeFeedback, {
    trial_id: trial.trial_id,
    phase: "outcome_feedback",
    deadline_s: feedbackDuration,
    valid_keys: [],
    block_id,
    condition_id: spec.condition_id,
    task_factors: {
      stage: "outcome_feedback",
      p_left: spec.p_left,
      p_right: spec.p_right,
      block_idx
    },
    stim_id: "outcome_feedback"
  });
  outcomeFeedback
    .show({ duration: feedbackDuration })
    .set_state({
      reward_win: (snapshot: TrialSnapshot) =>
        resolveRewardWin(snapshot, spec.p_left, spec.p_right, spec.reward_draw_u),
      reward_delta: (snapshot: TrialSnapshot) =>
        resolveRewardWin(snapshot, spec.p_left, spec.p_right, spec.reward_draw_u)
          ? rewardWinVal
          : rewardLossVal,
      total_score: (snapshot: TrialSnapshot) =>
        rewardTracker.current() +
        (resolveRewardWin(snapshot, spec.p_left, spec.p_right, spec.reward_draw_u)
          ? rewardWinVal
          : rewardLossVal)
    })
    .to_dict();

  const iti = trial.unit("iti").addStim(stimBank.get("fixation"));
  set_trial_context(iti, {
    trial_id: trial.trial_id,
    phase: "iti",
    deadline_s: itiDuration,
    valid_keys: [],
    block_id,
    condition_id: spec.condition_id,
    task_factors: {
      stage: "iti",
      block_idx
    },
    stim_id: "fixation"
  });
  iti.show({ duration: itiDuration }).to_dict();

  trial.finalize((snapshot, _runtime, helpers) => {
    const choiceKey = String(snapshot.units.bandit_choice?.choice_key ?? leftKey);
    const choiceSide = getChoiceSideFromKey(choiceKey, leftKey);
    const choiceRt = snapshot.units.bandit_choice?.choice_rt;
    const rewardWin = Boolean(snapshot.units.outcome_feedback?.reward_win);
    const rewardDelta = Number(snapshot.units.outcome_feedback?.reward_delta ?? 0);
    const totalScore = rewardTracker.update(rewardDelta);
    helpers.setTrialState("condition", spec.condition_id);
    helpers.setTrialState("p_left", spec.p_left);
    helpers.setTrialState("p_right", spec.p_right);
    helpers.setTrialState("choice_key", choiceKey);
    helpers.setTrialState("choice_side", choiceSide);
    helpers.setTrialState("choice_rt", choiceRt);
    helpers.setTrialState("choice_made", snapshot.units.bandit_choice?.choice_made === true);
    helpers.setTrialState("choice_forced", snapshot.units.bandit_choice?.choice_forced === true);
    helpers.setTrialState("reward_win", rewardWin);
    helpers.setTrialState("reward_delta", rewardDelta);
    helpers.setTrialState("total_score", totalScore);
  });

  return trial;
}
