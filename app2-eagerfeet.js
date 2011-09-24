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
var export = require('./export-gpx.js');

var dbconf = require('./db-conf.js').dbconf;

var dbClient = mysql.createClient(dbconf);

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

function newUserWithNikeID(nikeID) {
	maxUserID += 1;
	var newUser = {
		userID:				maxUserID,
		nikeID:				nikeID,
		runkeeperUserID:	null,
		runkeeperToken:		null
	};
	
	users[maxUserID] = newUser;
	
	dbClient.query('insert into Users set userID = ?, nikeID = ?', [maxUserID, nikeID]);
	
	return newUser;
}

process.on('exit', function () {
	dbClient.end();
});

process.on('uncaughtException', function (err) {
	console.log((new Date())+' :: Caught exception: ' + err + '\n' + err.stack + '\n');
});

var app = express.createServer();

app.get('/api2/runs/:userID', function(req, res) {
	var user = findUserByNikeID(req.params.userID);
	if (user == null) {
		user = newUserWithNikeID(req.params.userID);
	}
	nike.makeUserRunList(user.userID, req.params.userID, res, new Date());
});

app.get('/api2/poll/:userID', function(req, res) {
	nike.poll(users[req.params.userID].nikeID, res);
});

app.get('/api2/getGPX/:runID', function(req, res) {
	export.exportGPX(dbClient, req.params.runID, res);
});

app.get('/api2/ping', function(req, res) {
	res.setHeader('Cache-Control', 'no-store');
	res.send('OK\n');
});

app.get('/api2/rk/authData', function(req, res) {
	res.send(runkeeper.authData());
});

//app.get('/api2/rk/login/:userID', function(req, res) {
//	console.log(req.params.userID+', '+req.query.code);
app.get('/api2/rk/login', function(req, res) {
	console.log('code: '+req.query.code);
	runkeeper.getToken(req.query.code, res);
//	res.send('Success!\n');
});


loadUsers();
nike.init(dbClient);
app.listen(5556);