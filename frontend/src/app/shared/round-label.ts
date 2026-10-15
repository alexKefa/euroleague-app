import { Pipe, PipeTransform, inject } from "@angular/core";
import { I18nService } from "../core/i18n.service";

/**
 * Display name for a round number (2026-10-15). The feed numbers the
 * postseason as rounds after the regular season: with 38 regular-season
 * rounds (20 teams, since 2025-26) that's 39-40 play-in, 41-45 playoff
 * Games 1-5, 46 the Final Four semifinals and 47 the final. Mirrored in
 * backend services/roundLabel.ts for push notifications.
 */
export const REGULAR_SEASON_ROUNDS = 38;

export function roundLabel(i18n: I18nService, round: number | null | undefined, short = false): string {
  if (round == null) return "";
  const after = round - REGULAR_SEASON_ROUNDS;
  const key = short ? "round.short." : "round.";
  if (after <= 0) return i18n.t(key + "regular").replace("{n}", String(round));
  if (after <= 2) return i18n.t(key + "playIn");
  if (after <= 7) return i18n.t(key + "playoffs").replace("{n}", String(after - 2));
  if (after === 8) return i18n.t(key + "semifinals");
  return i18n.t(key + "final");
}

/**
 * `{{ r | roundLabel: i18n.lang() }}` → "Round 5" / "Play-in" / "Playoffs · Game 2".
 * Pass `'short'` as the second argument for tight spots ("R5", "PI", "G2").
 * The lang argument only exists so this pure pipe re-runs on a language switch.
 */
@Pipe({ name: "roundLabel", standalone: true })
export class RoundLabelPipe implements PipeTransform {
  private i18n = inject(I18nService);

  transform(round: number | null | undefined, _lang?: string, variant?: "short"): string {
    return roundLabel(this.i18n, round, variant === "short");
  }
}
