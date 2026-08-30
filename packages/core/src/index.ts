export { MinUIEngine, type MinUIEngineOptions } from "./MinUIEngine.js";

export { EventStore, type EventStoreSnapshot } from "./EventStore.js";
export { RankingEngine, type RankOptions } from "./RankingEngine.js";
export {
  LayoutStabilizer,
  type RecomputeOptions,
  type RecomputeResult,
  type Swap,
} from "./LayoutStabilizer.js";

export { contextBoost } from "./contextBoost.js";
export { MenuIndex, type IndexedMenu } from "./search/MenuIndex.js";
export {
  LearnedTerms,
  isLearnable,
  type LearnInput,
  type LearnedMatch,
} from "./search/LearnedTerms.js";
export {
  SearchPipeline,
  type MatchStage,
  type SearchCandidate,
  type SearchOptions,
  type SearchOutcome,
} from "./search/SearchPipeline.js";
export { combineRisk, requiresConfirm } from "./risk.js";
export {
  checkTransfer,
  requiresExtraConfirm,
  type PastTransfer,
  type SafetyKind,
  type SafetyLevel,
  type SafetyNote,
  type TransferFacts,
} from "./safety.js";
export {
  COPILOT_INTENTS,
  MAX_WHY_CHARS,
  nextSteps,
  validateProposal,
  validateProposals,
  type CopilotIntent,
  type CopilotProposal,
  type NextStepOptions,
  type RejectReason,
  type Validated,
} from "./copilot.js";
export { calibrate, mergeNeural } from "./search/neural.js";
export { buildReprompt } from "./search/reprompt.js";
export type {
  Reprompt,
  RepromptChoice,
  RepromptSettings,
} from "./search/reprompt.js";
export type {
  NeuralMatch,
  NeuralRetriever,
  NeuralSettings,
} from "./search/neural.js";
export {
  NgramTfIdfProvider,
  type SerializedNgramIndex,
} from "./search/NgramTfIdfProvider.js";
export type { EmbeddingProvider, IndexDocument } from "./search/EmbeddingProvider.js";
export {
  resolveVoiceAction,
  type VoiceAction,
  type VoiceActionInput,
} from "./search/voiceAction.js";
export { normalize } from "./search/normalize.js";
export {
  parseAmount,
  pickFromList,
  type PickOptions,
} from "./search/slots.js";
export { jamoDistance, jamoSimilarity, toJamo } from "./search/hangul.js";
export {
  calendarFields,
  circularDayDistance,
  circularHourDistance,
  type CalendarFields,
} from "./calendar.js";
export { DEFAULT_PROFILE, coldStartCards, isColdStart } from "./coldStart.js";
export { groupByPath, headingText, type MenuGroup } from "./menuGroups.js";
export { MemoryStorageAdapter } from "./storage/MemoryStorageAdapter.js";

export {
  DAY_MS,
  DEFAULT_CONFIG,
  resolveConfig,
  type ContextWeights,
  type MinUIConfig,
  type PartialConfig,
  type RankingWeights,
} from "./config.js";

export type {
  ActionHandler,
  CardExplanation,
  CardReason,
  Clock,
  ColdStartPresets,
  ColdStartProfile,
  Contrast,
  LayoutState,
  LearnedTerm,
  MenuCatalog,
  MenuId,
  MenuItem,
  PersistedState,
  RankedCard,
  RiskLevel,
  ScoreBreakdown,
  SlotExtractor,
  Slots,
  StorageAdapter,
  TextScale,
  UsageEvent,
  UsageEventType,
  UsageIntent,
  Visit,
  VisitAggregate,
} from "./types.js";
