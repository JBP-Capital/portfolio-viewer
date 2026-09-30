CREATE TABLE "pairing_codes" (
	"code" char(6) PRIMARY KEY NOT NULL,
	"poll_secret_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"device_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pairing_codes_poll_secret_hash_unique" UNIQUE("poll_secret_hash")
);
--> statement-breakpoint
CREATE TABLE "tv_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	CONSTRAINT "tv_devices_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "pairing_codes" ADD CONSTRAINT "pairing_codes_device_id_tv_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."tv_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tv_devices" ADD CONSTRAINT "tv_devices_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;