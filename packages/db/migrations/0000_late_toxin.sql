CREATE TYPE "public"."instrument_type" AS ENUM('stock', 'etf', 'etc', 'fund', 'bond', 'index', 'other');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."member_status" AS ENUM('invited', 'active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."transaction_source" AS ENUM('manual', 'import');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('buy', 'sell', 'dividend', 'transfer_in', 'transfer_out', 'split', 'exchange_out', 'exchange_in');--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"currency" char(3) NOT NULL,
	"date" date NOT NULL,
	"per_eur" numeric NOT NULL,
	CONSTRAINT "fx_rates_currency_date_pk" PRIMARY KEY("currency","date")
);
--> statement-breakpoint
CREATE TABLE "instruments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"isin" text,
	"type" "instrument_type" DEFAULT 'stock' NOT NULL,
	"sector" text,
	"country" text,
	"logo_url" text,
	"default_listing_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instruments_isin_unique" UNIQUE("isin")
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instrument_id" uuid NOT NULL,
	"mic" text NOT NULL,
	"symbol" text NOT NULL,
	"currency" char(3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"email" text NOT NULL,
	"role" "member_role" DEFAULT 'member' NOT NULL,
	"status" "member_status" DEFAULT 'invited' NOT NULL,
	"display_name" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"base_currency" char(3) DEFAULT 'EUR' NOT NULL,
	"timezone" text DEFAULT 'Europe/Berlin' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "members_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "members_email_unique" UNIQUE("email"),
	CONSTRAINT "members_email_lowercase" CHECK ("members"."email" = lower("members"."email"))
);
--> statement-breakpoint
CREATE TABLE "portfolios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"listing_id" uuid,
	"type" "transaction_type" NOT NULL,
	"trade_date" date NOT NULL,
	"quantity" numeric,
	"price" numeric,
	"currency" char(3) NOT NULL,
	"fx_rate" numeric NOT NULL,
	"fees" numeric DEFAULT 0 NOT NULL,
	"taxes" numeric DEFAULT 0 NOT NULL,
	"amount" numeric,
	"split_ratio" numeric,
	"link_id" uuid,
	"note" text,
	"source" "transaction_source" DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "instruments" ADD CONSTRAINT "instruments_default_listing_id_listings_id_fk" FOREIGN KEY ("default_listing_id") REFERENCES "public"."listings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "listings_mic_symbol_idx" ON "listings" USING btree ("mic","symbol");--> statement-breakpoint
CREATE INDEX "portfolios_member_idx" ON "portfolios" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "transactions_portfolio_idx" ON "transactions" USING btree ("portfolio_id","trade_date");--> statement-breakpoint
CREATE INDEX "transactions_link_idx" ON "transactions" USING btree ("link_id");