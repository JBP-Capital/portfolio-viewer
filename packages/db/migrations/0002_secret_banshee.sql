CREATE TABLE "daily_prices" (
	"listing_id" uuid NOT NULL,
	"date" date NOT NULL,
	"close" numeric NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "daily_prices_listing_id_date_pk" PRIMARY KEY("listing_id","date")
);
--> statement-breakpoint
CREATE TABLE "fx_latest" (
	"currency" char(3) PRIMARY KEY NOT NULL,
	"per_eur" numeric NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intraday_prices" (
	"listing_id" uuid NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"price" numeric NOT NULL,
	CONSTRAINT "intraday_prices_listing_id_ts_pk" PRIMARY KEY("listing_id","ts")
);
--> statement-breakpoint
CREATE TABLE "job_status" (
	"job" text PRIMARY KEY NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"last_error_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"listing_id" uuid PRIMARY KEY NOT NULL,
	"price" numeric NOT NULL,
	"previous_close" numeric,
	"as_of" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reference_dividends" (
	"listing_id" uuid NOT NULL,
	"ex_date" date NOT NULL,
	"amount" numeric NOT NULL,
	CONSTRAINT "reference_dividends_listing_id_ex_date_pk" PRIMARY KEY("listing_id","ex_date")
);
--> statement-breakpoint
CREATE TABLE "reference_splits" (
	"listing_id" uuid NOT NULL,
	"date" date NOT NULL,
	"ratio" numeric NOT NULL,
	CONSTRAINT "reference_splits_listing_id_date_pk" PRIMARY KEY("listing_id","date")
);
--> statement-breakpoint
ALTER TABLE "daily_prices" ADD CONSTRAINT "daily_prices_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intraday_prices" ADD CONSTRAINT "intraday_prices_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_dividends" ADD CONSTRAINT "reference_dividends_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_splits" ADD CONSTRAINT "reference_splits_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;