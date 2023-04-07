CREATE TABLE `ntbb_oauth_clients` (
	owner TEXT NOT NULL,
	client_title TEXT NOT NULL,
	id TEXT NOT NULL PRIMARY KEY
);

CREATE TABLE `ntbb_oauth_tokens` (
	owner TEXT NOT NULL,
	client TEXT NOT NULL,
	id TEXT NOT NULL PRIMARY KEY,
	time BIGINT(20) NOT NULL
);
