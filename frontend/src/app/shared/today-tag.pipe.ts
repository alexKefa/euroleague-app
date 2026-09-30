import { Pipe, PipeTransform, inject } from "@angular/core";
import { I18nService } from "../core/i18n.service";

const athensDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit", day: "2-digit" });

/**
 * " (Today)" / " (Σήμερα)" when the date falls on today's Athens calendar
 * day, else "". Placed right after a game date:
 * `{{ d | date: ... }}{{ d | todayTag: i18n.lang() }}`. The lang argument
 * only exists so this pure pipe re-runs on a language switch.
 */
@Pipe({ name: "todayTag", standalone: true })
export class TodayTagPipe implements PipeTransform {
  private i18n = inject(I18nService);

  transform(value: string | Date | null | undefined, _lang?: string): string {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return athensDay.format(d) === athensDay.format(new Date()) ? ` (${this.i18n.t("common.today")})` : "";
  }
}
