import { Pipe, PipeTransform } from "@angular/core";

/**
 * EuroLeague's own *public-site* 3-letter abbreviation for each club, as
 * shown on euroleaguebasketball.net's standings page (mobile view — the
 * desktop table shows full names instead). Deliberately NOT the same as
 * this app's `teams.code` — that's the feed's internal API club code and a
 * real request parameter the backend's Python sync scripts depend on
 * (confirmed 2026-09-02 directly against the live API: "KBA" — the site's
 * abbreviation for Baskonia — doesn't exist as an API club code at all,
 * only "BAS" does), so renaming it there would silently break future
 * syncs. This mapping is a presentation-only concern instead, applied
 * wherever a team code is actually shown to a user. Keyed by our internal
 * `teams.code`, since that's what every API response already carries.
 */
const TEAM_DISPLAY_CODES: Record<string, string> = {
  IST: "EFS", // Anadolu Efes Istanbul
  MIL: "MIL", // EA7 Emporio Armani Milan
  BES: "BJK", // Besiktas Istanbul
  RED: "CZV", // Crvena Zvezda Meridianbet Belgrade
  DUB: "DUB", // Dubai Basketball
  BAR: "BAR", // FC Barcelona
  MUN: "BAY", // FC Bayern Munich
  ULK: "FBT", // Fenerbahce Beko Istanbul
  HTA: "HTA", // Hapoel IBI Tel Aviv
  BAS: "KBA", // Kosner Baskonia Vitoria-Gasteiz
  ASV: "ASV", // LDLC ASVEL Villeurbanne
  TEL: "MTA", // Maccabi Rapyd Tel Aviv
  OLY: "OLY", // Olympiacos Piraeus
  PAN: "PAO", // Panathinaikos AKTOR Athens
  PRS: "PBB", // Paris Basketball
  PAR: "PAR", // Partizan Mozzart Bet Belgrade
  MAD: "RMB", // Real Madrid
  PAM: "VBC", // Valencia Basket
  VIR: "VIR", // Virtus Bologna
  ZAL: "ZAL", // Zalgiris Kaunas
  MCO: "MCO", // AS Monaco — not in the 2026-27 competition, no current site code to check
};

export function displayTeamCode(code: string | null | undefined): string {
  if (!code) return "";
  return TEAM_DISPLAY_CODES[code] ?? code;
}

@Pipe({ name: "teamCode", standalone: true })
export class TeamCodePipe implements PipeTransform {
  transform(code: string | null | undefined): string {
    return displayTeamCode(code);
  }
}
