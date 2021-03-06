/*
	Copyright (c) 2011, Robert Kosara <rkosara@me.com>
	
	Permission to use, copy, modify, and/or distribute this software for any
	purpose with or without fee is hereby granted, provided that the above
	copyright notice and this permission notice appear in all copies.
	
	THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
	WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
	MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
	ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
	WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
	ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
	OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
*/

var xml = require("node-xml");
var http = require('http');

var RUNLISTSERVER = 'nikerunning.nike.com';

var RUNLISTPATH = '/nikeplus/v2/services/app/run_list.jsp?userID=';

var RUNDATAPATH = '/nikeplus/v2/services/app/get_gps_detail.jsp?_plus=true&format=json&id=';

var MAXRETRIES = 5;

var METERS_PER_MILE = 1609.344;

var felt = [null, "Awesome", "So-So", "Sluggish", "Injured"];

var terrain = [null, "Road", "Trail", "Treadmill", "Track"];

var weather = [null, "Sunny", "Cloudy", "Rainy", "Snowy"];

var users = {};

// from http://dansnetwork.com/javascript-iso8601rfc3339-date-parser/
Date.prototype.setISO8601 = function(dString){

	var regexp = /(\d\d\d\d)(-)?(\d\d)(-)?(\d\d)(T)?(\d\d)(:)?(\d\d)(:)?(\d\d)(\.\d+)?(Z|([+-])(\d\d)(:)?(\d\d))/;

	if (dString.toString().match(new RegExp(regexp))) {
		var d = dString.match(new RegExp(regexp));
		var offset = 0;
		
		this.setUTCDate(1);
		this.setUTCFullYear(parseInt(d[1],10));
		this.setUTCMonth(parseInt(d[3],10) - 1);
		this.setUTCDate(parseInt(d[5],10));
		this.setUTCHours(parseInt(d[7],10));
		this.setUTCMinutes(parseInt(d[9],10));
		this.setUTCSeconds(parseInt(d[11],10));
		if (d[12])
			this.setUTCMilliseconds(parseFloat(d[12]) * 1000);
		else
			this.setUTCMilliseconds(0);
			if (d[13] != 'Z') {
				offset = (d[15] * 60) + parseInt(d[17],10);
				offset *= ((d[14] == '-') ? -1 : 1);
				this.setTime(this.getTime() - offset * 60 * 1000);
			}
		} else {
			this.setTime(Date.parse(dString));
	}
	return this;
};

function serverRequest(path, userID, resultFunc) {

	var options = {
		host: RUNLISTSERVER,
		port: 80,
		path: path,
		headers: { Cookie: 'plusid='+userID+'&nikerunning.nike.com'}
	};

	http.get(options, function(response) {
		var body = '';
		response.on('data', function(chunk) {
			body += chunk;
		});	
		response.on('end', function() {
			resultFunc(body);
		});
	});
}

function storeRunInDB(userID, runID, run, runData, dbClient) {
	
	var minlat =  100000;
	var maxlat = -100000;
	var minlon =  100000;
	var maxlon = -100000;

	runData.plusService.route.waypointList.forEach(function(wp) {
		dbClient.query('replace Waypoints set runID = ?, time = ?, lat = ?, lon = ?, ele = ?',
							[runID, new Date(wp.time), wp.lat, wp.lon, wp.alt]);
		
		if (wp.lon < minlon)
			minlon = wp.lon;
		if (wp.lon > maxlon)
			maxlon = wp.lon;
		
		if (wp.lat < minlat)
			minlat = wp.lat;
		if (wp.lat > maxlat)
			maxlat = wp.lat;
	});

	if (run.hasHRData) {
		var values = run.hrData.data.split(', ');
		for (var i = 0; i < values.length; i++) {
			dbClient.query('replace Heartrates set runID = ?, offset = ?, heartrate = ?',
								[runID, i*run.hrData.intervalValue, values[i]]);
		}
		delete run.hrData;
	}

	var summary = runData.plusService.sportsData.runSummary;

	if (run.description.length == 0)
		run.description = null;

	dbClient.query('replace Runs set userID = ?, runID = ?, startTime = ?, distance = ?, '+
					'duration = ?, hasHRData = ?, calories = ?, howFelt = ?, weather = ?, ' + 
					'terrain = ?, note = ?, minlat = ?, maxlat = ?, minlon = ?, maxlon = ?, dateAdded = NOW()',
					[userID, runID, new Date(summary.startTime), summary.distance*1000,
					 summary.duration, run.hasHRData, summary.calories, felt[run.howFelt], weather[run.weather], terrain[run.terrain], run.description,
					 minlat, maxlat, minlon, maxlon]);
}

function convertRunData(user, run, dbClient) {
	serverRequest(RUNDATAPATH + run.nikeID, user.nikeID, function(body) {
		try {
			runData = JSON.parse(body);
		} catch (error) {
			console.log((new Date())+' :: Caught exception: ' + error + '\n');
			console.log('Offending document: '+body+'\n');
			runData = {plusService: {status: 'failure'}};
		}
		
		if (runData.plusService.status === 'success') {
			
			if (run.hasHRData && runData.plusService.sportsData.extendedDataList != undefined) {
			
				var extData = runData.plusService.sportsData.extendedDataList.extendedData;
				var hrData = null;
				extData.forEach(function(item) {
					if (item.dataType == 'heartRate')
						hrData = item;
				});
				run.hasHRData = (hrData != null);
				run.hrData = hrData;
			} else {
//				if (run.hasHRData)
//					console.log('Run '+run.nikeID+' of user '+user.nikeID+' claims to have heartrate data but doesn\'t');
				run.hasHRData = false;
			}
			
			storeRunInDB(user.userID, run.runID, run, runData, dbClient);
			
			if (user.responses.length > 0) {
				sendRun(user.responses.pop(), run, user.userID);
			} else {
				user.runsDone.unshift(run);
			}
			
			user.runsLeft -= 1;
			
			if (user.runsLeft == 0) {
//				user.dbClient.end();
//				delete user.dbClient;
//				console.log('dbClient destroyed');
			}
						
		} else {
			if (run.retryCount < MAXRETRIES) {
				run.retryCount += 1;
				process.nextTick(function() {
					convertRunData(user, run, dbClient);
				});
			} else {
				//console.log('giving up on '+run.runID+'...');
				user.runsLeft -= 1;
				
				if (user.runsLeft == 0) {
//					user.dbClient.end();
//					delete user.dbClient;
//					console.log('dbClient destroyed');
				}
			}
		}
	});
}

function parseXML(xmlString, callback) {

	var status = '';
	var runs = [];

	var enclosingElement = '';

	var parser = new xml.SaxParser(function(cb) {

		var currentRun = null;

		cb.onStartElementNS(function(elem, attrs, prefix, uri, namespaces) {
			enclosingElement = elem;
			if (elem == 'run') {
				currentRun = {
					runID:			'nike-'+attrs[0][1],
					nikeID:			attrs[0][1],
					startTime:		'',
					distance:		'',
					duration:		'',
					calories:		'',
					description:	'',
					howFelt:		'',
					weather:		'',
					terrain:		'',
					hasHRData:		false,
					hasGPSData:		false,
					inDB:			false,
					retryCount:		0
				};
				runs.push(currentRun);
			} else if (elem == 'heartrate') {
				currentRun.hasHRData = true;
			} else if (elem == 'runListSummary') {
				currentRun = null;
			}
		});
		cb.onCharacters(function(chars) {
			if (currentRun != null) {
				if (enclosingElement == 'startTime') {
					currentRun.startTime += chars;
				} else if (enclosingElement == 'distance') {
					currentRun.distance += chars;
				} else if (enclosingElement == 'duration') {
					currentRun.duration += chars;
				} else if (enclosingElement == 'calories') {
					currentRun.calories += chars;
				} else if (enclosingElement == 'howFelt') {
					currentRun.howFelt += chars;
				} else if (enclosingElement == 'weather') {
					currentRun.weather += chars;
				} else if (enclosingElement == 'terrain') {
					currentRun.terrain += chars;
				} else if (enclosingElement == 'gpxId') {
					currentRun.hasGPSData = true;
				}
			} else if (enclosingElement == 'status') {
				status += chars;
			}
		});
		cb.onEndDocument(function() {
			callback(status, runs);
		});
		cb.onCdata(function(cdata) {
			if (enclosingElement == 'description')
				currentRun.description += cdata;
		});
		cb.onWarning(function(msg) {
			console.log('PARSER WARNING: '+msg);
		});
		cb.onError(function(msg) {
			console.log('PARSER ERROR: '+JSON.stringify(msg));
			callback('failure', runs);
		});
	});
	
	parser.parseString(xmlString);
}

exports.makeUserRunList = function(userID, nikeID, response, dbClient) {
	serverRequest(RUNLISTPATH + nikeID, nikeID, function(body) {
	
		parseXML(body, function(status, runs) {
			
			if (status != "success") {
				response.setHeader('Cache-Control', 'no-store');
				response.send({
					code: -1,
					message: '<b>Error</b>: User '+nikeID+' not found. Is your profile public (see <i>Troubleshooting</i> in the sidebar)?'
				});
				
			} else {

				runs.reverse();
				
				var numGPS = 0;
				runs.forEach(function(run) {
					if (run.hasGPSData)
						numGPS += 1;
				});
								
				var user = {
					userID:		userID,
					nikeID:		nikeID,
					runs:		runs,
					runsDone:	[],
					responses:	[],
					dbClient:	dbClient,
					runsLeft:	0
				};
				
				users[nikeID] = user;

				dbClient.query('select runID from Runs where userID = ?', [userID],
					function(err, results, fields) {

						var inDB = 0;
						results.forEach(function(dbRun) {
							runs.forEach(function(run) {
								if (run.runID == dbRun.runID) {
									run.inDB = true;
									inDB += 1;
								}
							});
						});

						user.runsLeft = numGPS-inDB;

						for (var i = 0; i < runs.length; i++) {
							if (!runs[i].inDB) {
								if (runs[i].hasGPSData) {
									convertRunData(user, runs[i], dbClient);
								} else {
									var run = runs[i];
									
									description = run.description;
									if (description.length == 0)
										description = null;
									dbClient.query('insert ignore into Runs set userID = ?, runID = ?, startTime = ?, distance = ?, duration = ?, calories = ?, howFelt = ?, weather = ?, terrain = ?, note = ?, hasGPSData = 0, dateAdded = NOW()',
										[userID, run.runID, new Date(run.startTime), run.distance*1000, run.duration, run.calories, felt[+run.howFelt], weather[+run.weather], terrain[+run.terrain], description]);
								}
							}
						}
						
						response.setHeader('Cache-Control', 'no-store');
						response.send({
							code:	0,
							userID:	userID,
							runs:	runs,
							numGPS:	numGPS
						});
					});
			}
		});
	});
}

function sendRun(response, run, userID) {
	response.setHeader('Cache-Control', 'no-store');
	response.send({
		code:	0,
		runID:	run.runID,
		userID:	userID
	});
}

exports.poll = function(nikeID, response) {
	var user = users[nikeID];
	if (user) {
		if (user.runsDone.length > 0) {
			sendRun(response, user.runsDone.pop(), user.userID);
		} else {
			user.responses.unshift(response)
		}
	} else {
		//console.log('User '+userID+' not found!');
		response.setHeader('Cache-Control', 'no-store');
		response.send({
			code: -1
		});
	}
}
