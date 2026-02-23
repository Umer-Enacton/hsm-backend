CREATE TABLE "feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"booking_id" integer,
	"rating" numeric(2, 1) NOT NULL,
	"comments" varchar(2000),
	"created_at" timestamp DEFAULT now() NOT NULL
);
