import { Pipe, PipeTransform, inject } from "@angular/core";
import { I18nService } from "../core/i18n.service";
import { roundStage } from "./round-stage";

/** Display name for a round number (2026-10-15); the numbering lives in round-stage.ts. */
export function roundLabel(i18n: I18nService, round: number | null | undefined, short = false): string {
  if (round == null) return "";
  const { stage, n } = roundStage(round);
  return i18n.t((short ? "round.short." : "round.") + stage).replace("{n}", String(n));
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
