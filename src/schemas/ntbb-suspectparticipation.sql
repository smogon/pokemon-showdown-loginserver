-- Table structure for suspect participation tracking

CREATE TABLE `ntbb_suspect_participation` (
	entryid int NOT NULL PRIMARY KEY AUTO_INCREMENT,
	start_date bigint(20) NOT NULL,
	userid varchar(18) NOT NULL,
	w int,
	l int,
	t int,
	qualified bool,
	UNIQUE KEY `startuser` (`start_date`,`userid`)
) AUTO_INCREMENT=1;
