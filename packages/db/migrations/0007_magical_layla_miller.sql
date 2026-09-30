CREATE TABLE "benchmarks" (
	"listing_id" uuid PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "benchmarks" ADD CONSTRAINT "benchmarks_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;