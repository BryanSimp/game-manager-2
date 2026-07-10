CREATE TYPE "public"."import_item_resolution" AS ENUM('pending', 'auto', 'manual', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."import_job_status" AS ENUM('pending', 'ocr', 'matching', 'review', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."import_source" AS ENUM('screenshot', 'shelf_photo', 'text_paste');--> statement-breakpoint
CREATE TABLE "import_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"raw_text" text NOT NULL,
	"cleaned_title" text NOT NULL,
	"candidates" jsonb,
	"confidence" real,
	"resolution" "import_item_resolution" DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"source" "import_source" NOT NULL,
	"status" "import_job_status" DEFAULT 'pending' NOT NULL,
	"image_id" uuid,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_items" ADD CONSTRAINT "import_items_job_id_import_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_items_job_idx" ON "import_items" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "import_jobs_user_idx" ON "import_jobs" USING btree ("user_id");