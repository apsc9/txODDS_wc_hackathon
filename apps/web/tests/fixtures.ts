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

// Real recorded packets: data/recordings/devnet-odds-2026-07-14.jsonl
// (fixture 18237038 France-Spain). The feed publishes BOTH a full-time
// (`MarketPeriod: null`) and a first-half (`MarketPeriod: "half=1"`) series
// for the same SuperOddsType + MarketParameters — these pairs pin that the
// two series must not share a consensus key (FT fair was oscillating
// 77%↔30% as the series alternated).
export const REAL_OU15_FT_ODDS_LINE =
  '{"FixtureId":18237038,"MessageId":"1837766769:00003:001855-10021-stab","Ts":1784047884573,"Bookmaker":"TXLineStablePriceDemargined","BookmakerId":10021,"SuperOddsType":"OVERUNDER_PARTICIPANT_GOALS","GameState":null,"InRunning":false,"MarketParameters":"line=1.5","MarketPeriod":null,"PriceNames":["over","under"],"Prices":[1290,4448],"Pct":["77.519","22.482"]}';

export const REAL_OU15_HALF1_ODDS_LINE =
  '{"FixtureId":18237038,"MessageId":"1837766125:00003:000064-10021-stab","Ts":1784047526034,"Bookmaker":"TXLineStablePriceDemargined","BookmakerId":10021,"SuperOddsType":"OVERUNDER_PARTICIPANT_GOALS","GameState":null,"InRunning":false,"MarketParameters":"line=1.5","MarketPeriod":"half=1","PriceNames":["over","under"],"Prices":[3338,1428],"Pct":["29.958","70.028"]}';

export const REAL_1X2_FT_ODDS_LINE_18237038 =
  '{"FixtureId":18237038,"MessageId":"1837690429:00003:000161-10021-stab","Ts":1784000557004,"Bookmaker":"TXLineStablePriceDemargined","BookmakerId":10021,"SuperOddsType":"1X2_PARTICIPANT_RESULT","GameState":null,"InRunning":false,"MarketParameters":null,"MarketPeriod":null,"PriceNames":["part1","draw","part2"],"Prices":[2488,3346,3342],"Pct":["40.193","29.886","29.922"]}';

export const REAL_1X2_HALF1_ODDS_LINE_18237038 =
  '{"FixtureId":18237038,"MessageId":"1837690338:00003:000030-10021-stab","Ts":1784000501681,"Bookmaker":"TXLineStablePriceDemargined","BookmakerId":10021,"SuperOddsType":"1X2_PARTICIPANT_RESULT","GameState":null,"InRunning":false,"MarketParameters":null,"MarketPeriod":"half=1","PriceNames":["part1","draw","part2"],"Prices":[3253,2241,4057],"Pct":["30.741","44.623","24.649"]}';
