// Real recorded odds packets shared across test files (not a test file
// itself — vitest only collects tests/**/*.test.ts). Each constant is the
// exact string openStream's onMsg would hand to ingestOdds.

// Real recorded packet: data/recordings/devnet-odds-2026-07-07.jsonl, first
// OVERUNDER_PARTICIPANT_GOALS line (fixture 18202701, `line=2.5`), copied
// verbatim from the JSONL row's "data" field.
export const REAL_OVERUNDER_ODDS_LINE =
  '{"FixtureId":18202701,"MessageId":"1836733400:00003:000105-10021-stab","Ts":1783435234232,"Bookmaker":"TXLineStablePriceDemargined","BookmakerId":10021,"SuperOddsType":"OVERUNDER_PARTICIPANT_GOALS","GameState":null,"InRunning":false,"MarketParameters":"line=2.5","MarketPeriod":null,"PriceNames":["over","under"],"Prices":[2082,1924],"Pct":["48.031","51.975"]}';

// Real recorded packet: data/recordings/devnet-odds-2026-07-07.jsonl, first
// 1X2_PARTICIPANT_RESULT line for the same fixture as the OVERUNDER line
// above — copied verbatim from the JSONL row's "data" field.
export const REAL_1X2_ODDS_LINE =
  '{"FixtureId":18202701,"MessageId":"1836733399:00003:000006-10021-stab","Ts":1783435233092,"Bookmaker":"TXLineStablePriceDemargined","BookmakerId":10021,"SuperOddsType":"1X2_PARTICIPANT_RESULT","GameState":null,"InRunning":false,"MarketParameters":null,"MarketPeriod":null,"PriceNames":["part1","draw","part2"],"Prices":[1363,5326,12700],"Pct":["73.368","18.776","7.874"]}';
