import { Pipe, PipeTransform } from "@angular/core";
import { displayTeamCode } from "./team-display-codes";

// The code map and displayTeamCode live in team-display-codes.ts (Angular-free).
export { displayTeamCode } from "./team-display-codes";

@Pipe({ name: "teamCode", standalone: true })
export class TeamCodePipe implements PipeTransform {
  transform(code: string | null | undefined): string {
    return displayTeamCode(code);
  }
}
