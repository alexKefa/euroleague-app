import { Component, Input } from "@angular/core";
import { CommonModule } from "@angular/common";
import { CollectibleFinish, CollectibleTier } from "../../core/models";
import { CollectibleCardComponent } from "./collectible-card";

/**
 * The Store grid's tile for a player with more than one tier — the same
 * card face as CollectibleCardComponent, with 1-2 offset "ghost" edges
 * peeking out behind it to read as a stack, plus a count badge. A player
 * with only one tier (no legendary print, e.g.) renders with zero ghosts
 * and no badge, so it's visually identical to a plain single card.
 */
@Component({
  selector: "app-card-stack",
  standalone: true,
  imports: [CommonModule, CollectibleCardComponent],
  templateUrl: "./card-stack.html",
})
export class CardStackComponent {
  @Input({ required: true }) name!: string;
  @Input({ required: true }) tier!: CollectibleTier;
  @Input() teamCode = "";
  @Input() teamColor: string | null = null;
  @Input() imageUrl: string | null = null;
  @Input() unlocked = false;
  @Input() maxWidth = 220;
  @Input() stackCount = 1;
  @Input() finish: CollectibleFinish = "standard";
  @Input() jerseyNumber: number | null = null;
}
