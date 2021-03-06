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

var express = require('express');
var mysql = require('mysql');

var runkeeper = require('./runkeeper.js');
var nike = require('./nike.js');
var gpx = require('./export-gpx.js');

var dbconf = require('./db-conf.js').dbconf;

var dbClient;

var APIPREFIX = '/api/';

var users = {};

var maxUserID = 1000;

function loadUsers() {
	dbClient.query('select * from Users', function(err, results, fields) {
		results.forEach(function(user) {
			users[user.userID] = user;
			if (user.userID > maxUserID)
				maxUserID = user.userID;
		});
	});
}

function findUserByNikeID(nikeID) {
	for (var userID in users) {
		if (users[userID].nikeID == nikeID)
			return users[userID];
	}
	return null;
}

function newUserWithNikeID(nikeID, dbClient) {
	maxUserID += 1;
	var newUser = {
		userID:				maxUserID,
		nikeID:				nikeID,
		runkeeperUserID:	null,
		runkeeperToken:		null
	};
	
	users[maxUserID] = newUser;
	
	dbClient.query('insert into Users set userID = ?, nikeID = ?, dateAdded = NOW()',
						[maxUserID, nikeID]);
	
	return newUser;
}

process.on('exit', function () {
});

process.on('uncaughtException', function (err) {
	console.log((new Date())+' :: Caught exception: ' + err + '\n' + err.stack + '\n');
});

var app = express.createServer();

app.get(APIPREFIX+'runs/:userID', function(req, res) {	
	var user = findUserByNikeID(req.params.userID, dbClient);
	if (user == null) {
		user = newUserWithNikeID(req.params.userID, dbClient);
	}
	nike.makeUserRunList(user.userID, req.params.userID, res, dbClient);
});

app.get(APIPREFIX+'poll/:userID', function(req, res) {
	nike.poll(users[req.params.userID].nikeID, res);
});

app.get(APIPREFIX+'getGPX/:runID', function(req, res) {
	gpx.exportGPX(dbClient, req.params.runID, res);
});

app.get(APIPREFIX+'ping', function(req, res) {
	dbClient.query('select max(distance) as maxDistance, sum(distance) as sumDistance, count(*) as runCount from Runs where hasGPSData = 1', function(err, results, fields) {
		res.setHeader('Cache-Control', 'no-store');
		if (err)
			res.send(JSON.stringify({status: 'DB Down!'}));
		else {
			var dataObject = results[0];
			dataObject.status = 'OK';
			res.send(JSON.stringify(dataObject));
		}
	});
});

app.get(APIPREFIX+'rk/authData', function(req, res) {
	res.send(runkeeper.authData());
});

//app.get('/api2/rk/login/:userID', function(req, res) {
//	console.log(req.params.userID+', '+req.query.code);
app.get(APIPREFIX+'rk/login', function(req, res) {
	console.log('code: '+req.query.code);
	runkeeper.getToken(req.query.code, res);
//	res.send('Success!\n');
});

dbClient = mysql.createClient(dbconf);
loadUsers();
app.listen(5555);