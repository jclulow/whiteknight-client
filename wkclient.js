#!/usr/bin/env node

var pty = require('pty.js');
var tls = require('tls');
var net = require('net');
var Shaft = require('shaft').Shaft;
var fs = require('fs');
var path = require('path');
var assert = require('assert');

var BUFFER_EMPTY = new Buffer(0);

var MSG_REQ_SESSION = 0xC000;
var MSG_NEW_SESSION = 0xC001;

var MSG_LOG_MESSAGE = 0xC010;

var MSG_PROC_DATA = 0xC100;
var MSG_PROC_EXIT = 0xC110;
var MSG_PROC_KILL = 0xC111;
var MSG_PROC_RESIZE = 0xC120;

function _log(str)
{
  console.log(str);
}

var client = tls.connect({
  host: 'eng.joyent.com',
  port: 10502
});

var _connected = false;
var _shaft = null;
var _x = 80;
var _y = 25;
var _term = null;
var _session_name = null;

function start_process()
{
  assert(_term === null);

  _term = pty.spawn('/bin/bash', [ '--login' ], {
    name: 'vt100',
    cols: _x,
    rows: _y,
    env: process.env,
    cwd: process.env.HOME
  });

  _term.on('data', function(ch) {
    if (!Buffer.isBuffer(ch))
      ch = new Buffer(ch);

    _shaft.send(MSG_PROC_DATA, ch);
  });

  _term.on('exit', function() {
    _log('process exit, sending EXIT');

    _shaft.send(MSG_PROC_EXIT, BUFFER_EMPTY);
  });
}

client.on('secureConnect', function() {
  _log('connected'); 
  _connected = true;

  client.setNoDelay(true);
  _shaft = new Shaft(client);

  /*
   * XXX Send the key we were given to the server.
   */
  _shaft.send(MSG_REQ_SESSION, BUFFER_EMPTY);

  _shaft.once('fail', function(msg) {
    _log('shaft protocol failure: ' + msg);
  });
  _shaft.once('end', function() {
    _log('end');
    process.exit(0);
  });

  _shaft.on('message', function(msgtype, msgbuf) {
    var msgs = [];
    switch (msgtype) {
      case MSG_LOG_MESSAGE:
        _log(msgbuf.toString('utf8'));
        break;

      case MSG_NEW_SESSION:
        _session_name = msgbuf.toString('ascii');
        _log('your session id is ' + _session_name);
        _log('starting bash...');
        start_process();
        _log('');
        break;

      case MSG_PROC_DATA: // DATA
        assert(_term !== null);
        _term.write(msgbuf);
        break;

      case MSG_PROC_KILL: // KILL
        break;

      case MSG_PROC_RESIZE: // RESIZE
        _x = msgbuf.readUInt16BE(0);
        _y = msgbuf.readUInt16BE(2);
        if (_term !== null)
          _term.resize(_x, _y);
        break;

      default:
        _log('unknown message type ' + msgtype);
        _shaft.end();
    }
  });
});
