ALTER TABLE "collections" ADD COLUMN "is_public" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "adopted_from_id" uuid;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_adopted_from_id_collections_id_fk" FOREIGN KEY ("adopted_from_id") REFERENCES "public"."collections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collections_public_idx" ON "collections" USING btree ("is_public");