CREATE TYPE "public"."gender" AS ENUM('masculine', 'feminine', 'unisex');--> statement-breakpoint
CREATE TYPE "public"."image_role" AS ENUM('main', 'alternate');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('queued', 'running', 'waiting_choice', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."list_kind" AS ENUM('wishlist', 'collection');--> statement-breakpoint
CREATE TYPE "public"."perfume_origin" AS ENUM('google-sheet', 'url-import', 'manual');--> statement-breakpoint
CREATE TYPE "public"."personal_rating" AS ENUM('rebuy', 'very_good', 'good', 'do_not_rebuy');--> statement-breakpoint
CREATE TYPE "public"."visibility" AS ENUM('private', 'public');--> statement-breakpoint
CREATE TABLE "entries" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"product_id" text NOT NULL,
	"list" "list_kind" NOT NULL,
	"variant_id" text,
	"position" integer NOT NULL,
	"rating" "personal_rating",
	"notes" text,
	"source_url" text,
	"variant_url" text,
	"volume_text" text,
	"volume_ml" numeric(7, 2),
	"price" numeric(12, 2),
	"currency" char(3),
	"price_note" text,
	"added_at" timestamp with time zone NOT NULL,
	"acquired_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "entries_price_nonnegative" CHECK ("entries"."price" is null or "entries"."price" >= 0),
	CONSTRAINT "entries_currency_format" CHECK ("entries"."currency" is null or "entries"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "entries_volume_positive" CHECK ("entries"."volume_ml" is null or "entries"."volume_ml" > 0),
	CONSTRAINT "entries_notes_length" CHECK ("entries"."notes" is null or char_length("entries"."notes") <= 1000)
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"status" "import_status" DEFAULT 'queued' NOT NULL,
	"input" jsonb NOT NULL,
	"progress_stage" text,
	"progress_percent" integer DEFAULT 0 NOT NULL,
	"result" jsonb,
	"error" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "import_jobs_progress_range" CHECK ("import_jobs"."progress_percent" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "product_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" text NOT NULL,
	"position" integer NOT NULL,
	"role" "image_role" NOT NULL,
	"ref" text NOT NULL,
	"thumb_ref" text,
	"master_ref" text,
	"variant_id" text,
	"transparent" boolean,
	"source" json,
	"credit" text,
	"sha256" char(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"product_id" text NOT NULL,
	"id" text NOT NULL,
	"position" integer NOT NULL,
	"label" text NOT NULL,
	"volume_text" text,
	"volume_ml" numeric(7, 2),
	"price" numeric(12, 2),
	"currency" char(3),
	"sku" text,
	"available" boolean,
	"url" text,
	CONSTRAINT "product_variants_product_id_id_pk" PRIMARY KEY("product_id","id"),
	CONSTRAINT "product_variants_price_nonnegative" CHECK ("product_variants"."price" is null or "product_variants"."price" >= 0),
	CONSTRAINT "product_variants_currency_format" CHECK ("product_variants"."currency" is null or "product_variants"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "product_variants_volume_positive" CHECK ("product_variants"."volume_ml" is null or "product_variants"."volume_ml" > 0)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"brand" text,
	"name" text NOT NULL,
	"concentration" text,
	"gender" "gender",
	"description" text,
	"olfactory_profile" json,
	"dominant_color" text,
	"dominant_color_override" text,
	"accent_color" text,
	"accent_glow" text,
	"model_3d_ref" text,
	"field_sources" json NOT NULL,
	"origin" "perfume_origin" NOT NULL,
	"asset_version" integer DEFAULT 1 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_name_not_blank" CHECK (btrim("products"."name") <> '')
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"display_name" text NOT NULL,
	"avatar_ref" text,
	"bio" text,
	"email" text,
	"privacy_profile" "visibility" DEFAULT 'private' NOT NULL,
	"privacy_wishlist" "visibility" DEFAULT 'private' NOT NULL,
	"privacy_collection" "visibility" DEFAULT 'private' NOT NULL,
	"library_revision" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_format" CHECK ("users"."username" ~ '^[a-z0-9._]{3,30}$'),
	CONSTRAINT "users_bio_length" CHECK ("users"."bio" is null or char_length("users"."bio") <= 280)
);
--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_variant_fk" FOREIGN KEY ("product_id","variant_id") REFERENCES "public"."product_variants"("product_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_variant_fk" FOREIGN KEY ("product_id","variant_id") REFERENCES "public"."product_variants"("product_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "entries_user_product_list_key" ON "entries" USING btree ("user_id","product_id","list");--> statement-breakpoint
CREATE INDEX "entries_user_list_position_idx" ON "entries" USING btree ("user_id","list","position");--> statement-breakpoint
CREATE INDEX "entries_product_idx" ON "entries" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "import_jobs_owner_created_idx" ON "import_jobs" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "import_jobs_status_idx" ON "import_jobs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "product_images_product_ref_key" ON "product_images" USING btree ("product_id","ref");--> statement-breakpoint
CREATE INDEX "product_images_product_position_idx" ON "product_images" USING btree ("product_id","position");--> statement-breakpoint
CREATE INDEX "products_brand_name_idx" ON "products" USING btree (lower("brand"),lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_key" ON "users" USING btree (lower("username"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree (lower("email")) WHERE "users"."email" is not null;