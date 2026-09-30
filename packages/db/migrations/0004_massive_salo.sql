CREATE TABLE "dismissed_splits" (
	"portfolio_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"date" date NOT NULL,
	CONSTRAINT "dismissed_splits_portfolio_id_instrument_id_date_pk" PRIMARY KEY("portfolio_id","instrument_id","date")
);
--> statement-breakpoint
ALTER TABLE "dismissed_splits" ADD CONSTRAINT "dismissed_splits_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dismissed_splits" ADD CONSTRAINT "dismissed_splits_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE cascade ON UPDATE no action;