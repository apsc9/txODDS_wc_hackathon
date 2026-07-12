export const BASE = {
  GOALS_T1: 1,
  GOALS_T2: 2,
  YELLOWS_T1: 3,
  YELLOWS_T2: 4,
  REDS_T1: 5,
  REDS_T2: 6,
  CORNERS_T1: 7,
  CORNERS_T2: 8,
} as const;

export type PredicateFields = {
  statKeyA: number;
  statKeyB: number | null;
  op: "Add" | "Subtract" | null;
  comparison: "GreaterThan" | "LessThan" | "EqualTo";
  threshold: number;
};

export function encodeStatKey(period: number, base: number): number {
  return period * 1000 + base;
}

export function decodeStatKey(key: number): { period: number; base: number } {
  return {
    period: Math.floor(key / 1000),
    base: key % 1000,
  };
}

const STAT_LABELS: Record<number, string> = {
  1: "GOALS",
  3: "YELLOWS",
  5: "REDS",
  7: "CORNERS",
};

const PERIOD_SUFFIX: Record<number, string> = {
  0: "FT",
  1: "P1",
  2: "P2",
};

function getBaseLabel(base: number): string {
  const oddBase = base % 2 === 1 ? base : base - 1;
  return STAT_LABELS[oddBase] || `STAT${base}`;
}

function getTeamSuffix(base: number): "T1" | "T2" {
  return base % 2 === 1 ? "T1" : "T2";
}

export function predicateMono(m: PredicateFields): string {
  const decoded_a = decodeStatKey(m.statKeyA);
  const label_a = getBaseLabel(decoded_a.base);
  const suffix_a = getTeamSuffix(decoded_a.base);
  const period_a = PERIOD_SUFFIX[decoded_a.period] || `P${decoded_a.period}`;

  let left = `${label_a}·${period_a}(${suffix_a})`;

  if (m.statKeyB !== null && m.op !== null) {
    const decoded_b = decodeStatKey(m.statKeyB);
    const label_b = getBaseLabel(decoded_b.base);
    const suffix_b = getTeamSuffix(decoded_b.base);
    const period_b = PERIOD_SUFFIX[decoded_b.period] || `P${decoded_b.period}`;

    const operand_b = `${label_b}·${period_b}(${suffix_b})`;
    const opSymbol = m.op === "Add" ? "+" : "-";

    left = `${left}${opSymbol}${operand_b}`;
  }

  const compSymbol =
    m.comparison === "GreaterThan"
      ? ">"
      : m.comparison === "LessThan"
        ? "<"
        : "==";

  return `${left} ${compSymbol} ${m.threshold}`;
}

export function predicateHuman(
  m: PredicateFields,
  t1?: string,
  t2?: string
): string {
  const decoded_a = decodeStatKey(m.statKeyA);
  const base_a = decoded_a.base;
  const stat_a = getBaseLabel(base_a);

  // Special case: home win (subtract goals T1-T2 > 0)
  if (
    m.statKeyB !== null &&
    m.op === "Subtract" &&
    m.comparison === "GreaterThan" &&
    m.threshold === 0
  ) {
    const decoded_b = decodeStatKey(m.statKeyB);
    if (
      base_a === BASE.GOALS_T1 &&
      decoded_b.base === BASE.GOALS_T2 &&
      decoded_a.period === decoded_b.period
    ) {
      const teamName = t1 ?? "Home";
      return `${teamName} to win`;
    }
  }

  // Add cases (over/under)
  if (m.statKeyB !== null && m.op === "Add") {
    const decoded_b = decodeStatKey(m.statKeyB);
    const base_b = decoded_b.base;
    const stat_b = getBaseLabel(base_b);

    // Both same stat type (goals, yellows, reds, corners)
    if (
      stat_a === stat_b &&
      decoded_a.period === decoded_b.period &&
      base_a % 2 === 1 &&
      base_b % 2 === 0 &&
      base_b === base_a + 1
    ) {
      const statName =
        stat_a === "GOALS"
          ? "goals"
          : stat_a === "YELLOWS"
            ? "yellow cards"
            : stat_a === "CORNERS"
              ? "corners"
              : "reds";

      if (m.comparison === "GreaterThan") {
        return `Over ${m.threshold + 0.5} total ${statName}`;
      } else if (m.comparison === "LessThan") {
        return `Under ${m.threshold + 0.5} total ${statName}`;
      } else if (m.comparison === "EqualTo") {
        return `Exactly ${m.threshold} total ${statName}`;
      }
    }
  }

  // Fallback to mono format
  return predicateMono(m);
}

export function canNeedZeroStat(m: PredicateFields): boolean {
  return m.comparison !== "GreaterThan" || m.threshold < 1;
}

// Fixture-page group tabs (Task 11 brief: "GOALS/CORNERS/CARDS/RESULT
// filter by base key"). YELLOWS and REDS share one tab ("CARDS") — the
// mockup has no separate reds tab and the seeded slate only exercises
// yellows, so a 5th tab would be speculative. Anything encoded as a
// team-vs-team subtraction (op "Subtract", e.g. the home-win predicate) is
// a match-result market regardless of which stat it's built from, so that
// check runs before the base-label lookup.
export type MarketGroup = "GOALS" | "CORNERS" | "CARDS" | "RESULT";

export function marketGroup(m: PredicateFields): MarketGroup {
  if (m.op === "Subtract") return "RESULT";

  const { base } = decodeStatKey(m.statKeyA);
  const label = getBaseLabel(base);
  if (label === "GOALS") return "GOALS";
  if (label === "CORNERS") return "CORNERS";
  if (label === "YELLOWS" || label === "REDS") return "CARDS";
  return "RESULT";
}
