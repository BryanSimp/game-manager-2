import { pgEnum } from "drizzle-orm/pg-core";
import {
  CHECKLIST_KINDS,
  FRIENDSHIP_STATUSES,
  GAME_STATUSES,
  OWNERSHIP_FORMATS,
  PLATFORM_FAMILIES,
  PROGRESS_BASES,
} from "@gm/shared";

export const gameStatusEnum = pgEnum("game_status", GAME_STATUSES);
export const ownershipFormatEnum = pgEnum("ownership_format", OWNERSHIP_FORMATS);
export const platformFamilyEnum = pgEnum("platform_family", PLATFORM_FAMILIES);
export const ttbSourceEnum = pgEnum("ttb_source", ["igdb", "manual"]);
export const checklistKindEnum = pgEnum("checklist_kind", CHECKLIST_KINDS);
export const progressBasisEnum = pgEnum("progress_basis", PROGRESS_BASES);
export const friendshipStatusEnum = pgEnum("friendship_status", FRIENDSHIP_STATUSES);
export const imageKindEnum = pgEnum("image_kind", [
  "cover",
  "custom_cover",
  "shelf_photo",
  "background",
]);
